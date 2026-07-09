#!/bin/bash
# comment-checker-disable-file
# Vendored from github.com/jasonesiegel/claude-code-extensions (MIT, see LICENSE),
# unmodified except the cc-utility sidecar block. Matches the upstream file's own
# comment density; do not strip comments from the vendored portions.

# Read JSON input from stdin
input=$(cat)

# ANSI Color Codes — aligned with Design System dark-mode semantic tokens
# success: oklch(0.7 0.17 145)  → xterm 114 (light sea green)
# warning: oklch(0.82 0.16 70)  → xterm 221 (light goldenrod)
# danger:  oklch(0.7 0.19 28)   → xterm 210 (light coral)
BOLD=$'\033[1m'
SUCCESS=$'\033[38;5;114m'
WARNING=$'\033[38;5;221m'
DANGER=$'\033[38;5;210m'
CRITICAL=$'\033[38;5;177m'
# spend: blue — real session cost, shown only for API/pay-as-you-go users.
# Off the good→bad spectrum on purpose: cost is information, not "bad".
SPEND=$'\033[38;5;75m'
COST=$'\033[38;5;80m'
DIM=$'\033[2m'
# Dim variants — darker xterm colors for empty bar segments (avoids DIM attribute)
SUCCESS_DIM=$'\033[38;5;65m'
WARNING_DIM=$'\033[38;5;136m'
DANGER_DIM=$'\033[38;5;131m'
CRITICAL_DIM=$'\033[38;5;97m'
FG_DIM=$'\033[38;5;244m'
FG_LIGHT=$'\033[38;5;252m'
RESET=$'\033[0m'

# Segment separator — dim middle dot, breathing space on both sides. SEP_NARROW is the
# width-pressed fallback: the dot drops to plain double-spacing (saves a column per separator),
# the last squeeze applied on lines 1 and 2 when they still overflow after everything else.
SEP=" ${FG_DIM}·${RESET} "
SEP_NARROW="  "

# Width-aware compression. Claude Code v2.1.153+ exports COLUMNS/LINES to the
# statusline script (it captures our stdout, so tput/`$(stty)` can't see the tty).
# We compress per line, measured against this budget, recomputed every render and
# never persisted — so a terminal resize is picked up on the next render, never
# "locked in". Absent COLUMNS (older Claude Code, non-interactive) -> no budget,
# so output is full-width exactly as before.
vis_width() { local s; s=$(printf '%s' "$1" | sed $'s/\033\\[[0-9;]*m//g'); printf '%s' "${#s}"; }
PK_MARGIN=2   # small reserve: notifications/auto-update msgs share the status row's right edge
if [ -n "$COLUMNS" ] && [ "$COLUMNS" -gt 0 ] 2>/dev/null; then PK_BUDGET=$((COLUMNS - PK_MARGIN)); else PK_BUDGET=9999; fi

# Extract fields
MODEL_DISPLAY=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
MODEL_DISPLAY=$(echo "$MODEL_DISPLAY" | sed -E 's/ *\([^)]*\) *$//')
# Reasoning effort (.effort.level): low/medium/high/xhigh/max. Reflects the live in-session
# value (mid-session /effort changes included). Absent when the model doesn't support effort
# -> // empty yields "" and the tag never renders.
EFFORT_LEVEL=$(echo "$input" | jq -r '.effort.level // empty')
CONTEXT_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
CTX_PERCENT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Rate limits (Max/Pro, absent before first API response)
FIVE_H_PCT=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_H_RESET=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
SEVEN_D_PCT=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
SEVEN_D_RESET=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Session cost & duration — always present in the cost object (not Pro/Max-gated).
# NOTE: total_cost_usd is an API-rate ESTIMATE (what the session would cost at
# pay-as-you-go rates). It is populated even on Pro/Max subscriptions — it is NOT
# 0 for in-plan usage — so it is meaningless as a real charge for subscribers.
# That's why the cost UI is gated on rate_limits presence below, not on this value.
COST_USD=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
case "$COST_USD" in ''|*[!0-9.]*) COST_USD=0 ;; esac   # numeric-only guard before awk

# Session name — the harness's native session title (the `ai-title`). Empirically
# it is set ONCE, mid-session, then frozen — NOT rolling: across 334 local sessions
# only a manual /rename ever changed the value. Used as the topic label so parallel
# sessions are distinguishable. Rendered via the deterministic shortener below; no
# LLM is involved (a former async Haiku/Opus labeler was removed — it added cost,
# transcript litter, and invented labels on generic titles, e.g. "Dropbox & Calendar
# Coding" for "Review remaining tasks and wrap up").
SESSION_NAME=$(echo "$input" | jq -r '.session_name // empty')

# Session id — keys the idle-wait sentinel (see the 🖐️ segment below). Per-session so
# parallel sessions stay independent. Absent/empty -> the indicator simply never renders.
SESSION_ID=$(echo "$input" | jq -r '.session_id // empty')

# Branch — always from git (source of truth)
CURRENT_DIR=$(echo "$input" | jq -r '.workspace.current_dir // empty')
BRANCH=$(git -C "$CURRENT_DIR" branch --show-current 2>/dev/null)
[ -z "$BRANCH" ] && BRANCH=$(echo "$input" | jq -r '.worktree.branch // empty')

# Worktree / checkout name — basename of the git worktree root (exact, no prefix stripping).
# Subdir = relative path from worktree root to cwd (empty when at root).
WORKTREE_ROOT=$(git -C "$CURRENT_DIR" rev-parse --show-toplevel 2>/dev/null)
if [ -n "$WORKTREE_ROOT" ]; then
    WORKTREE_NAME=$(basename "$WORKTREE_ROOT")
    if [ "$CURRENT_DIR" != "$WORKTREE_ROOT" ]; then
        SUBDIR="${CURRENT_DIR#$WORKTREE_ROOT/}"
    else
        SUBDIR=""
    fi
else
    WORKTREE_NAME=$(basename "$CURRENT_DIR" 2>/dev/null)
    SUBDIR=""
fi

# Format context window size in M/K
format_k() {
    local num=$1
    if [ $num -ge 1000000 ]; then
        printf "%dM" $((num / 1000000))
    elif [ $num -ge 100000 ]; then
        printf "%dK" $((num / 1000))
    elif [ $num -ge 1000 ]; then
        printf "%dK" $(( (num + 500) / 1000 ))
    else
        echo "$num"
    fi
}
CTX_WINDOW_K=$(format_k $CONTEXT_SIZE)

# Build a colored bar for a given percentage.
# Fills with ▮ (narrow vertical rectangle), pads with dim-color ▮.
# Args: $1=pct, $2=ANSI fg color code, $3=width (default 5), $4=dim color
EMPTY_COLOR=$'\033[38;5;240m'
build_bar() {
    local pct=$1
    local color=$2
    local width=${3:-5}
    local dim_color=${4:-$EMPTY_COLOR}
    local filled=$(( (pct * width + 50) / 100 ))
    [ $filled -gt $width ] && filled=$width
    [ $filled -lt 0 ] && filled=0
    local empty=$((width - filled))
    local bar=""
    local i
    for ((i=0; i<filled; i++)); do bar+="${color}▮"; done
    local pad=""
    for ((i=0; i<empty; i++)); do pad+="${dim_color}▮"; done
    printf "%s%s%s" "$bar" "$pad" "$RESET"
}

# Capitalize an effort level for display. Known levels get exact forms (xhigh -> XHigh, which
# naive title-casing would get wrong); an unknown non-empty value is generically title-cased so
# a future level still renders sanely. Empty in -> empty out (the tag then never renders).
cap_effort() {
    case "$1" in
        "")     ;;
        low)    printf 'Low' ;;
        medium) printf 'Medium' ;;
        high)   printf 'High' ;;
        xhigh)  printf 'XHigh' ;;
        max)    printf 'Max' ;;
        *)      printf '%s%s' "$(printf '%s' "${1%"${1#?}"}" | tr '[:lower:]' '[:upper:]')" "${1#?}" ;;
    esac
}

# Abbreviate an effort display word for the narrow-width ladder rung. Length-based, NOT a per-level
# map, so a level added in a future Claude Code never breaks: any word longer than 4 chars collapses
# to its first 3 (Medium -> Med, XHigh -> XHi, a hypothetical Ultra -> Ult); Low/High/Max already fit
# and pass through unchanged (the abbreviate rung is then a harmless no-op for them).
abbr_effort() {
    if [ "${#1}" -gt 4 ]; then printf '%s' "${1:0:3}"; else printf '%s' "$1"; fi
}

# Threshold coloring for context (not a time window)
threshold_color() {
    local pct=$1
    if [ $pct -ge 60 ]; then echo "$CRITICAL"
    elif [ $pct -ge 50 ]; then echo "$DANGER"
    elif [ $pct -ge 40 ]; then echo "$WARNING"
    else echo "$SUCCESS"
    fi
}
threshold_color_dim() {
    local pct=$1
    if [ $pct -ge 60 ]; then echo "$CRITICAL_DIM"
    elif [ $pct -ge 50 ]; then echo "$DANGER_DIM"
    elif [ $pct -ge 40 ]; then echo "$WARNING_DIM"
    else echo "$SUCCESS_DIM"
    fi
}

# Velocity coloring — compare usage% to elapsed% of the window.
# Args: $1=usage pct, $2=seconds remaining, $3=window total seconds
# Rules (consistent at all elapsed values — no "too early to tell" grace):
#   Ratio-based pace: (usage/elapsed - 1) * 100 = % over pace
#   > 10  -> critical (violet)
#   >= 0  -> danger (red)
#   > -10 -> warning (yellow)
#   <= -10 -> success (green)
# Echoes "COLOR PACE" (e.g. "\033[...m 15")
velocity_info() {
    local usage=$1
    local remaining=$2
    local total=$3
    if [ -z "$remaining" ] || [ -z "$total" ]; then echo "$SUCCESS 0"; return; fi
    local elapsed=$((total - remaining))
    [ $elapsed -lt 0 ] && elapsed=0
    local elapsed_pct=$(( elapsed * 100 / total ))
    [ $elapsed_pct -lt 1 ] && elapsed_pct=1
    local pace=$(( (usage * 100 / elapsed_pct) - 100 ))
    local color
    if [ $pace -gt 10 ]; then color="$CRITICAL"
    elif [ $pace -ge 0 ]; then color="$DANGER"
    elif [ $pace -gt -10 ]; then color="$WARNING"
    else color="$SUCCESS"
    fi
    echo "$color $pace"
}
velocity_info_dim() {
    local usage=$1
    local remaining=$2
    local total=$3
    if [ -z "$remaining" ] || [ -z "$total" ]; then echo "$SUCCESS_DIM"; return; fi
    local elapsed=$((total - remaining))
    [ $elapsed -lt 0 ] && elapsed=0
    local elapsed_pct=$(( elapsed * 100 / total ))
    [ $elapsed_pct -lt 1 ] && elapsed_pct=1
    local pace=$(( (usage * 100 / elapsed_pct) - 100 ))
    if [ $pace -gt 10 ]; then echo "$CRITICAL_DIM"
    elif [ $pace -ge 0 ]; then echo "$DANGER_DIM"
    elif [ $pace -gt -10 ]; then echo "$WARNING_DIM"
    else echo "$SUCCESS_DIM"
    fi
}

# Elapsed-into-window — counts UP from window start, like context %/pace which also climb.
# Takes seconds-remaining + window total; elapsed = total - remaining. Renders XdYh | XhYm | Xm.
format_elapsed() {
    local remaining=$1
    local total=$2
    [ -z "$remaining" ] && return
    local elapsed=$((total - remaining))
    [ $elapsed -lt 0 ] && elapsed=0
    local days=$((elapsed / 86400))
    local hours=$(( (elapsed % 86400) / 3600 ))
    local mins=$(( (elapsed % 3600) / 60 ))
    if [ $days -gt 0 ]; then printf "%dd%dh" $days $hours
    elif [ $hours -gt 0 ]; then printf "%dh%dm" $hours $mins
    else printf "%dm" $mins
    fi
}

# Current epoch seconds — the single clock read for the whole script. Honors the
# PACEKIT_NOW env override so tests can freeze time and exercise the velocity, idle-wait,
# and window-reset paths deterministically against the same instant. Unset -> real clock.
now_epoch() {
    if [ -n "$PACEKIT_NOW" ]; then printf '%s' "$PACEKIT_NOW"; else date +%s; fi
}

# Seconds-until-reset helper for velocity calc
secs_until() {
    local epoch=$1
    [ -z "$epoch" ] && { echo ""; return; }
    local now; now=$(now_epoch)
    local diff=$((epoch - now))
    [ $diff -lt 0 ] && diff=0
    echo $diff
}

# cc-utility sidecar (optional, off by default): appends one JSON line per render to
# $CC_UTILITY_SIDECAR_LOG so cc-utility can build rate-limit history/pace trends over
# time, data Claude Code only ever hands to the statusline process, never the transcript.
# Placed after secs_until so resets_at (absolute epoch) is logged as seconds-remaining,
# matching cc-utility's fiveHourResetSec/sevenDayResetSec contract. Unset env var ->
# this whole block is a single no-op check; rendering is byte-identical to upstream.
if [ -n "$CC_UTILITY_SIDECAR_LOG" ]; then
    FIVE_H_REMAIN=$(secs_until "$FIVE_H_RESET")
    SEVEN_D_REMAIN=$(secs_until "$SEVEN_D_RESET")
    SIDECAR_LINE=$(jq -nc \
        --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg session_id "$SESSION_ID" \
        --arg five_hour_pct "$FIVE_H_PCT" \
        --arg five_hour_reset "$FIVE_H_REMAIN" \
        --arg seven_day_pct "$SEVEN_D_PCT" \
        --arg seven_day_reset "$SEVEN_D_REMAIN" \
        --arg cost_usd "$COST_USD" \
        '{ts: $ts, session_id: $session_id,
          five_hour_pct: (if $five_hour_pct == "" then null else ($five_hour_pct | tonumber) end),
          five_hour_reset: (if $five_hour_reset == "" then null else ($five_hour_reset | tonumber) end),
          seven_day_pct: (if $seven_day_pct == "" then null else ($seven_day_pct | tonumber) end),
          seven_day_reset: (if $seven_day_reset == "" then null else ($seven_day_reset | tonumber) end),
          cost_usd: ($cost_usd | tonumber)}' 2>/dev/null)
    if [ -n "$SIDECAR_LINE" ]; then
        mkdir -p "$(dirname "$CC_UTILITY_SIDECAR_LOG")" 2>/dev/null || true
        echo "$SIDECAR_LINE" >> "$CC_UTILITY_SIDECAR_LOG" 2>/dev/null || true
    fi
fi

# Compact duration label from a raw millisecond delta — Xm | XhYm | XdYh (same
# shape as format_elapsed; takes ms, not seconds). Sole caller is the 🖐️ idle-wait
# indicator below; the standalone ◷ session-duration segment was removed (#313).
format_duration() {
    local ms=${1:-0}
    local secs=$((ms / 1000))
    local days=$((secs / 86400))
    local hours=$(( (secs % 86400) / 3600 ))
    local mins=$(( (secs % 3600) / 60 ))
    if [ $days -gt 0 ]; then printf "%dd%dh" $days $hours
    elif [ $hours -gt 0 ]; then printf "%dh%dm" $hours $mins
    else printf "%dm" $mins
    fi
}

# Cost — formats a USD float for display, or empty when zero/absent (hidden on line 1).
# Sub-cent but non-zero renders "<$0.01"; otherwise "$X.XX".
format_cost() {
    local raw=${1:-0}
    local positive=$(awk -v c="$raw" 'BEGIN { print (c > 0) ? 1 : 0 }')
    [ "$positive" != "1" ] && { echo ""; return; }
    local rounded=$(awk -v c="$raw" 'BEGIN { printf "%.2f", c }')
    if [ "$rounded" = "0.00" ]; then echo "<\$0.01"
    else echo "\$${rounded}"
    fi
}

# Subdir at a "keep level" — how many trailing path components to show. k >= the
# component count returns the FULL path verbatim (no ellipsis); 0 < k < count
# returns "…/" + the last k components, signalling hidden ancestors. The split is
# glob-safe (read -ra, not parts=($path)) so a component like "[archive]" can't
# glob-expand against the filesystem — the same trap shorten_title already fixed.
subdir_at_level() {
    local path=$1 k=$2
    local parts; IFS='/' read -ra parts <<< "$path"
    local n=${#parts[@]}
    if [ "$k" -ge "$n" ]; then printf '%s' "$path"; return; fi
    local out="" i
    for (( i = n - k; i < n; i++ )); do out+="/${parts[$i]}"; done
    printf '…%s' "$out"
}

# Cap a single name (worktree/branch) at 24 chars with a trailing ellipsis.
cap_name() {
    local name=$1
    local max=24
    if [ ${#name} -gt $max ]; then printf "%s…" "${name:0:$max}"
    else printf "%s" "$name"
    fi
}

# Shorten the native session title for the topic label: drop the leading verb AND
# every consecutive leading particle so the distinguishing words lead. Only LEADING
# particles are skipped — a mid-title preposition is preserved (e.g. "Switch from
# Anthropic API to subscription" -> "Anthropic API to subscription"). Guards:
#   word2 in if/whether/that/why/how/when/where -> leave intact (verb carries meaning)
#   verb + only particles (e.g. "Wrap up and")  -> leave intact (never empty / no
#                                                   leading particle)
# Skip set = articles + connectives + phrasal particles + prepositions. Examples:
#   "Read from Mac Notes app"    -> "Mac Notes app"
#   "Review the parser"          -> "Parser"
#   "Wrap up and report bug"     -> "Report bug"
#   "Wrap up after handoff"      -> "Handoff"
# Capitalizes only the first letter of the new lead word (interior case preserved,
# e.g. "stratechery-import" -> "Stratechery-import").
shorten_title() {
    local title=$1
    # Split on spaces WITHOUT glob-expanding — an unquoted $title would expand
    # *, ?, [ in a title against the filesystem. read -ra is glob-safe.
    local words=()
    IFS=' ' read -ra words <<< "$title"
    local n=${#words[@]}
    [ "$n" -lt 2 ] && { printf '%s' "$title"; return; }
    local w2
    w2=$(printf '%s' "${words[1]}" | tr '[:upper:]' '[:lower:]' | tr -d '.,')
    # Word 2 is an interrogative/complementizer -> the verb carries the meaning; keep intact.
    case " if whether that why how when where " in
        *" $w2 "*) printf '%s' "$title"; return ;;
    esac
    # Drop the verb, then skip consecutive leading particles to the first content word.
    # Bound is n (not n-1) so the "ran past the end" guard below can fire.
    local start=1 i w
    for (( i = 1; i < n; i++ )); do
        w=$(printf '%s' "${words[$i]}" | tr '[:upper:]' '[:lower:]' | tr -d '.,')
        case " the a an and or up in out off down over through upon with for from to of about between into onto after before during on " in
            *" $w "*) start=$((i + 1)) ;;
            *) break ;;
        esac
    done
    # Verb followed only by particles -> nothing distinctive to lead with; keep intact.
    [ "$start" -ge "$n" ] && { printf '%s' "$title"; return; }
    local rest=("${words[@]:$start}")
    local first=${rest[0]}
    rest[0]="$(printf '%s' "${first:0:1}" | tr '[:lower:]' '[:upper:]')${first:1}"
    printf '%s' "${rest[*]}"
}

# Single line: context | 5h rate | 7d rate | model + branch
CTX_COLOR=$(threshold_color $CTX_PERCENT)
CTX_COLOR_DIM=$(threshold_color_dim $CTX_PERCENT)
FIVE_H_TOTAL=$((5 * 3600))
SEVEN_D_TOTAL=$((7 * 86400))

# Split the model display into name + version so the line-1 width ladder can drop the version
# ("Opus 4.8" -> "Opus") independently of the name. The version is the trailing number.dots token;
# a display with no such token (e.g. "Unknown") leaves MODEL_VER empty, so the version-drop rung
# is simply a no-op there.
MODEL_NAME="$MODEL_DISPLAY"
MODEL_VER=""
case "$MODEL_DISPLAY" in
    *' '[0-9]*)
        _last=${MODEL_DISPLAY##* }
        case "$_last" in
            *[!0-9.]*) ;;                               # trailing token not pure number.dots -> no split
            *) MODEL_NAME=${MODEL_DISPLAY% *}; MODEL_VER=$_last ;;
        esac
        ;;
esac

# Effort tag — the session's reasoning effort, shown bare right after the model on
# line 1 (e.g. "Opus 4.8 High"). Rendered in light gray at NORMAL weight (not bold) so it reads
# as secondary to the bold model name. EFFORT_DISP is the full display word ("" when the model
# doesn't support effort -> nothing renders, line 1 byte-identical to before). render_line1 wraps
# it (full or abbreviated) per the PK_E_ABBR lever; the body is not precomputed here because the
# width ladder rebuilds it each pass.
EFFORT_DISP=$(cap_effort "$EFFORT_LEVEL")

# Context-usage stamp — persist the live context-window fill the model can't see itself,
# so skills can read it: /context-usage on demand, and wrap-up when choosing the compound
# mode (a near-full window biases toward Lightweight). Keyed by session_id, overwritten
# every render so it's always fresh; "<pct> <size> <epoch>". Best-effort — a failed write
# never affects rendering (mirrors the wait-stamp pattern below).
if [ -n "$SESSION_ID" ]; then
    echo "${CTX_PERCENT} ${CONTEXT_SIZE} $(now_epoch)" > "/tmp/pacekit-ctx-$SESSION_ID" 2>/dev/null || true
fi

# Idle-wait indicator — 🖐️ + how long this session has been waiting on the user, shown
# right after the model so it's glanceable across parallel panes. The sentinel file is
# written by the pacekit-wait-stamp Stop hook on turn end and deleted by pacekit-wait-clear
# on the next prompt, so the segment's mere presence means "Claude is waiting on you".
# Keyed by session_id. Absent file or non-numeric content -> render nothing (stale/garbage
# guard). Sub-minute waits floor to 🖐️0m (format_duration has no seconds granularity).
# Captured as a body string WITHOUT its leading separator (render_line1 prepends the separator,
# picking the dotted or narrow form per the width ladder) so the line-1 ladder can rebuild the
# meta without re-reading the sentinel. The wait glyph itself never drops.
WAIT_BODY=""
if [ -n "$SESSION_ID" ]; then
    WAIT_FILE="/tmp/pacekit-wait-$SESSION_ID"
    if [ -f "$WAIT_FILE" ]; then
        WAIT_STAMP=$(cat "$WAIT_FILE" 2>/dev/null)
        case "$WAIT_STAMP" in
            ''|*[!0-9]*) ;;   # absent or non-numeric -> nothing
            *)
                WAIT_ELAPSED=$(( $(now_epoch) - WAIT_STAMP ))
                [ $WAIT_ELAPSED -lt 0 ] && WAIT_ELAPSED=0
                WAIT_BODY="${BOLD}${FG_LIGHT}🖐️$(format_duration $((WAIT_ELAPSED * 1000)))${RESET}"
                ;;
        esac
    fi
fi

# Session label — the harness's native session title, shortened for compactness
# (drop the leading verb so the distinguishing nouns lead). Right after the model
# so parallel sessions are distinguishable. No truncation, no LLM — pure, instant,
# and it can never invent a label the title doesn't support. Absent for short/young
# sessions before the harness names them -> nothing appended, so line 1 is identical
# to before the feature.
# Cost is shown ONLY for API/pay-as-you-go users (no rate_limits), where total_cost_usd is
# real money. On Pro/Max subscriptions it's just an API-equivalent token estimate, so we hide it.
# It is NOT placed on line 1: on API plans there is no rate-limit line, so line 2 is free —
# cost leads line 2 (in its own cyan, off the good->bad spectrum) and git follows it (see the
# print block). That keeps line 1 from becoming one over-stuffed line. Computed here, rendered below.
COST_TEXT=""
if [ -z "$FIVE_H_PCT" ] && [ -z "$SEVEN_D_PCT" ]; then
    COST_TEXT=$(format_cost "$COST_USD")
fi

LABEL_BODY=""
if [ -n "$SESSION_NAME" ]; then
    LABEL_BODY="${SPEND}$(shorten_title "$SESSION_NAME")${RESET}"
fi

# Git meta (⑂ worktree /subdir ⎇ branch) as a standalone segment with NO leading separator,
# so the print block below can place it on line 3 (Pro/Max) or line 2 after cost (API). Built
# once here. Branch hidden when it duplicates the worktree name.
build_git() {  # $1 = subdir display string — built via a fn so we can swap a compressed subdir
    local g=""
    [ -n "$WORKTREE_NAME" ] && g+="${FG_LIGHT}⑂ $(cap_name "$WORKTREE_NAME")${RESET}"
    [ -n "$1" ] && g+="${FG_DIM}/$1${RESET}"
    [ -n "$BRANCH" ] && [ "$BRANCH" != "$WORKTREE_NAME" ] && g+=" ${FG_LIGHT}⎇ $(cap_name "$BRANCH")${RESET}"
    printf '%s' "$g"
}
# Build the git segment, compressing ONLY the subdir to fit the available width —
# the responsive line-3 (and API line-2) ladder. Rungs, applied in order and only
# while the segment still overflows (re-measured after each step):
#   0  full path (every level)            -- shown whenever it fits
#   1..n-1  drop outermost ancestors one level at a time -> "…/<last k>"
#   n-1 reached -> child only ("…/<child>")
#   then truncate the child to "…/<3+ chars>…" (keep the …/ marker) -- ONLY when a
#        branch renders, since the whole point is to keep the branch visible
#   last resort -> drop the subdir entirely (worktree + branch)
# Worktree and branch are never compressed here; they keep their 24-char cap_name.
# $1 = reserve: visible width already spent on this line before git (0 on line 3;
# cost+separator on API line 2). No COLUMNS (PK_BUDGET 9999) -> rung 0, full path.
fit_git() {
    local reserve=${1:-0}
    local budget=$((PK_BUDGET - reserve))
    local seg; seg=$(build_git "$SUBDIR")
    { [ "$PK_BUDGET" -ge 9999 ] || [ -z "$SUBDIR" ]; } && { printf '%s' "$seg"; return; }
    [ "$(vis_width "$seg")" -le "$budget" ] && { printf '%s' "$seg"; return; }
    local parts; IFS='/' read -ra parts <<< "$SUBDIR"
    local n=${#parts[@]} k
    for (( k = n - 1; k >= 1; k-- )); do
        seg=$(build_git "$(subdir_at_level "$SUBDIR" "$k")")
        [ "$(vis_width "$seg")" -le "$budget" ] && { printf '%s' "$seg"; return; }
    done
    # Child-only still overflows. Truncate the child (3-char-prefix floor) only to
    # protect a rendering branch; reuse build_git's exact branch-render predicate.
    local child=${parts[$((n-1))]}
    if [ -n "$BRANCH" ] && [ "$BRANCH" != "$WORKTREE_NAME" ] && [ ${#child} -gt 4 ]; then
        local t=${#child}
        while [ "$t" -gt 3 ]; do
            t=$((t-1))
            seg=$(build_git "…/${child:0:$t}…")
            [ "$(vis_width "$seg")" -le "$budget" ] && { printf '%s' "$seg"; return; }
        done
    fi
    printf '%s' "$(build_git "")"          # last resort: drop the subdir
}
GIT_SEG=$(fit_git 0)

# Git is never on line 1. On Pro/Max it rides line 3 (or line 2 when both windows just reset);
# on API plans it follows cost on line 2. All of that happens in the print block below.

# Line-1 width ladder. Line 1 = bar + pct% + model/context meta + idle-wait + session label. As the
# terminal narrows, model/context adornments shed in order: model version ("4.8") first (lowest
# signal once "Opus" names the model), then the effort tag abbreviates ("Medium" -> "Med"), then
# the context-window size ("1M"). The effort tag is a permanent anchor like the model NAME: it may
# abbreviate under pressure but never drops entirely, so the effort signal is always visible. The
# model NAME ("Opus") is likewise a permanent anchor: we never shed the whole model block. The label is
# never self-truncated (shorten_title front-loads it; the terminal's own clip is the safe
# degradation). The bar, pct%, and idle-wait never drop either. render_line1 composes the line at a
# given bar width honoring the meta levers; fit_line1 runs the ladder against PK_BUDGET, measuring
# INCLUDING the label so a long label can itself trigger drops — by design, since dropping meta is
# exactly what protects it.
render_line1() {
    local bars=$1
    local bar; bar=$(build_bar "$CTX_PERCENT" "$CTX_COLOR" "$bars" "$CTX_COLOR_DIM")
    local meta="${BOLD}${CTX_COLOR}${CTX_PERCENT}%${RESET}"
    # The "/" pairs the used-% with the window total, so it travels with the size lever.
    [ "${PK_C_SIZE:-1}" -eq 1 ] && meta+=" / ${BOLD}${FG_LIGHT}${CTX_WINDOW_K}${RESET}"
    local model=""
    [ "${PK_C_NAME:-1}" -eq 1 ] && model="$MODEL_NAME"
    if [ "${PK_C_VER:-1}" -eq 1 ] && [ -n "$MODEL_VER" ]; then
        if [ -n "$model" ]; then model="$model $MODEL_VER"; else model="$MODEL_VER"; fi
    fi
    [ -n "$model" ] && meta+=" ${BOLD}${FG_LIGHT}${model}${RESET}"
    # Effort tag joins the model block with a plain space (like the version/size), so it sits between
    # the model and the · that precedes the idle-wait/label. One ladder lever: PK_E_ABBR=1 swaps the
    # full word for its short form (Medium -> Med). The tag is a permanent anchor — it abbreviates
    # but never drops (the PK_C_EFF guard is kept for the empty-effort case, never set to 0).
    if [ "${PK_C_EFF:-1}" -eq 1 ] && [ -n "$EFFORT_DISP" ]; then
        local ed="$EFFORT_DISP"
        [ "${PK_E_ABBR:-0}" -eq 1 ] && ed=$(abbr_effort "$ed")
        meta+=" ${FG_LIGHT}${ed}${RESET}"
    fi
    # Idle-wait + label hang off separators; PK_C_SEP=0 collapses the dot to plain spacing.
    local sep="$SEP"; [ "${PK_C_SEP:-1}" -eq 0 ] && sep="$SEP_NARROW"
    local out="${bar} ${meta}"
    [ -n "$WAIT_BODY" ]  && out+="${sep}${WAIT_BODY}"
    [ -n "$LABEL_BODY" ] && out+="${sep}${LABEL_BODY}"
    printf '%s' "$out"
}
fit_line1() {
    local bars=$1
    PK_C_VER=1; PK_C_NAME=1; PK_C_SIZE=1; PK_C_SEP=1; PK_C_EFF=1; PK_E_ABBR=0
    LINE1=$(render_line1 "$bars")
    [ "$PK_BUDGET" -ge 9999 ] && return                       # no COLUMNS -> full width, as before
    [ "$(vis_width "$LINE1")" -le "$PK_BUDGET" ] && return     # already fits -> nothing to shed
    # Engage meta compression only once the session label DOMINATES the line — its width is at least
    # half the budget. Below that, the meta (and especially the distinctive, near-constant 1M size)
    # stays intact and the terminal clips the label's tail instead. So on a normal-width terminal
    # with a typical label, line 1 never shrinks; it kicks in only when a long label crowds the line.
    local label_w; label_w=$(vis_width "$LABEL_BODY")
    if [ $((label_w * 2)) -ge "$PK_BUDGET" ]; then
        # Shed model/context adornments in increasing order of signal, re-measuring after each step
        # (the NAME never drops, and neither does the effort tag — it only abbreviates). The effort
        # tag degrades gracefully — abbreviated, never dropped — so the effort signal is always shown:
        #   1. version (4.8)           — lowest signal once "Opus" names the model
        #   2. abbreviate effort       — Medium -> Med (no-op for already-short Low/High/Max)
        #   3. size (1M)               — distinctive, kept until late
        # The effort tag has no drop rung: it is a permanent anchor alongside the model NAME. Past
        # this point only the · separator collapses; remaining overflow clips the label tail (effort
        # sits left of the label, so it survives the clip).
        [ "$(vis_width "$LINE1")" -gt "$PK_BUDGET" ] && { PK_C_VER=0;   LINE1=$(render_line1 "$bars"); }
        [ "$(vis_width "$LINE1")" -gt "$PK_BUDGET" ] && { PK_E_ABBR=1;  LINE1=$(render_line1 "$bars"); }
        [ "$(vis_width "$LINE1")" -gt "$PK_BUDGET" ] && { PK_C_SIZE=0;  LINE1=$(render_line1 "$bars"); }
    fi
    # Final squeeze: collapse the · separators to plain spacing to buy the label a column or two.
    [ "$(vis_width "$LINE1")" -gt "$PK_BUDGET" ] && { PK_C_SEP=0; LINE1=$(render_line1 "$bars"); }
}
fit_line1 5

# Render one rate-limit window segment: bar, usage%, pace, elapsed-into-window, label.
# Args: $1=usage pct (raw), $2=reset epoch, $3=window total secs, $4=label (5h/7d)
#
# Reset-passed-while-idle: the statusline reads a frozen JSON snapshot whose resets_at can
# fall into the past when the session sits idle across a window boundary. The window has
# really rolled over, so the snapshot's usage% is stale (it describes the PREVIOUS window).
# We know the new window's elapsed precisely (now − last reset, mod window) but NOT its
# usage — no API call has refreshed it. So rather than fabricate a 0% or show the stale
# old %, render usage as a ↻ reset glyph with a dim-green empty bar and no pace: "this window
# just reset — its real number returns on your next message". The ↻ glyph stays the honest
# "unmeasured" marker; the bar is dim green (SUCCESS_DIM), not neutral gray, so the state reads
# as a fresh window rather than a broken/blank one — legibility chosen over a strictly-neutral
# bar. The limits are account-wide, so
# a freshly-reset window's usage is genuinely unknown (another session may have spent it), not
# zero. It self-corrects on the next message (which pulls a fresh snapshot). NOW_EPOCH is
# computed once by the caller so both windows judge "passed" against the same instant.
render_window() {
    local usage_raw=$1 reset=$2 total=$3 label=$4
    local usage; usage=$(printf '%.0f' "$usage_raw")
    if [ -n "$reset" ] && [ "$NOW_EPOCH" -ge "$reset" ]; then
        local new_elapsed=$(( (NOW_EPOCH - reset) % total ))
        local remaining=$((total - new_elapsed))
        local bar; bar=$(build_bar 0 "$SUCCESS_DIM" "${PK_W_BARS:-5}" "$SUCCESS_DIM")
        local elapsed_text; elapsed_text=$(format_elapsed "$remaining" "$total")
        printf '%s' "${bar} ${FG_DIM}↻${RESET} ${FG_LIGHT}${elapsed_text:-}${RESET} ${FG_DIM}/${RESET} ${FG_LIGHT}${label}${RESET}"
        return
    fi
    local remaining; remaining=$(secs_until "$reset")
    local color pace; read color pace <<< "$(velocity_info "$usage" "$remaining" "$total")"
    local color_dim; color_dim=$(velocity_info_dim "$usage" "$remaining" "$total")
    local bar; bar=$(build_bar "$usage" "$color" "${PK_W_BARS:-5}" "$color_dim")
    local elapsed_text; elapsed_text=$(format_elapsed "$remaining" "$total")
    local sign; sign=$([ "$pace" -ge 0 ] && echo "+" || echo "")
    # Width levers (set by the line-2 ladder): PK_W_FILL drops the fill % (redundant with the
    # bar); PK_W_DENOM drops the 5h/7d window total. The bar color + pace parenthetical never drop.
    local fill=""
    [ "${PK_W_FILL:-1}" -eq 1 ] && fill="${color_dim}${usage}%${RESET} "
    local tail
    if [ "${PK_W_DENOM:-1}" -eq 1 ]; then
        tail="${FG_LIGHT}${elapsed_text:-}${RESET} ${FG_DIM}/${RESET} ${FG_LIGHT}${label}${RESET}"
    else
        tail="${FG_LIGHT}${elapsed_text:-}${RESET}"
    fi
    printf '%s' "${bar} ${fill}(${BOLD}${color}${sign}${pace}%${RESET}) ${tail}"
}

# Line 2 — only rendered when both rate-limit windows are present (Pro/Max plans). On
# non-Pro/Max plans these fields are absent and the line is hidden entirely.
#
# Layout is fixed (no toggle): line 2 = both rate-limit windows, line 3 = git. Git always
# has a reliable home on line 3 — Claude Code renders its own permission-mode indicator on a
# separate row BELOW the statusline, so a third statusline line is not clobbered. The one
# exception is the both-windows-just-reset case (↻↻): two unmeasured windows say nothing, so
# git takes line 2 that turn and there is no line 3 (see the both-reset block below).
if [ -n "$FIVE_H_PCT" ] && [ -n "$SEVEN_D_PCT" ]; then
    NOW_EPOCH=$(now_epoch)
    build_limits() {                                # rebuildable so the ladder can re-render both windows
        FIVE_SEG=$(render_window "$FIVE_H_PCT" "$FIVE_H_RESET" "$FIVE_H_TOTAL" "5h")
        SEVEN_SEG=$(render_window "$SEVEN_D_PCT" "$SEVEN_D_RESET" "$SEVEN_D_TOTAL" "7d")
        local sep="$SEP"; [ "${PK_W_SEP:-1}" -eq 0 ] && sep="$SEP_NARROW"
        LIMITS_SEG="${FIVE_SEG}${sep}${SEVEN_SEG}"
    }
    # Width-aware line-2 ladder. Each step applies to BOTH windows together and fires only if line 2
    # still overflows: 1) shrink bars 5->3 (cheap, big recovery — and global, so the line-1 context
    # bar shrinks with it)  2) drop fill %  3) drop 5h/7d totals  4) collapse the · window separator
    # to plain spacing (the final squeeze; the bar color + pace never drop).
    PK_W_FILL=1; PK_W_BARS=5; PK_W_DENOM=1; PK_W_SEP=1; build_limits
    if [ "$PK_BUDGET" -lt 9999 ]; then
        [ "$(vis_width "$LIMITS_SEG")" -gt "$PK_BUDGET" ] && { PK_W_BARS=3;  build_limits; }
        [ "$(vis_width "$LIMITS_SEG")" -gt "$PK_BUDGET" ] && { PK_W_FILL=0;  build_limits; }
        [ "$(vis_width "$LIMITS_SEG")" -gt "$PK_BUDGET" ] && { PK_W_DENOM=0; build_limits; }
        [ "$(vis_width "$LIMITS_SEG")" -gt "$PK_BUDGET" ] && { PK_W_SEP=0;   build_limits; }
    fi
    # Bar count is a GLOBAL visual decision — keep the line-1 context bar consistent with the
    # window bars when they shrink (build_bar scales the fill math to any segment count), and
    # re-run the line-1 meta ladder at that bar width so its fit measurement matches what renders.
    fit_line1 "$PK_W_BARS"

    # Fixed layout: windows hold line 2, git rides line 3 (show=1). The only exception is
    # both windows just reset while idle -> both usages are unknown (account-wide, not
    # re-measured). Two ↻ windows say nothing useful, so git takes line 2 that turn and there
    # is no line 3 (show=0). The empty-GIT_SEG guard below still falls back to the two ↻
    # windows when there is no repo.
    show=1
    if [ -n "$FIVE_H_RESET" ] && [ "$NOW_EPOCH" -ge "$FIVE_H_RESET" ] \
       && [ -n "$SEVEN_D_RESET" ] && [ "$NOW_EPOCH" -ge "$SEVEN_D_RESET" ]; then
        show=0
    fi

    # Empty GIT_SEG (no repo) -> fall back to limits rather than render a blank line 2.
    LINE3=""
    if [ "$show" -eq 1 ] || [ -z "$GIT_SEG" ]; then
        LINE2="$LIMITS_SEG"
        # Windows hold line 2; git gets its own reliable line 3 (Claude Code's permission-mode
        # indicator renders on a separate row below the statusline, so line 3 is not clobbered).
        [ -n "$GIT_SEG" ] && LINE3="$GIT_SEG"
    else
        LINE2="$GIT_SEG"
    fi
    if [ -n "$LINE3" ]; then
        printf "%b\n%b\n%b\n" "$LINE1" "$LINE2" "$LINE3"
    else
        printf "%b\n%b\n" "$LINE1" "$LINE2"
    fi
else
    # API / pay-as-you-go: no rate-limit windows, so line 2 is free. Cost leads it (own cyan),
    # git follows. Line 1 stays clean (context, model, idle, label). No line 3. When there is
    # neither cost nor git, fall back to a single line 1 — exactly the original behavior.
    LINE2=""
    if [ -n "$COST_TEXT" ]; then
        COST_SEG="${BOLD}${COST}${COST_TEXT}${RESET}"
        LINE2="$COST_SEG"
        # Git shares line 2 with cost here, so re-fit it against the width cost already
        # spent (cost segment + separator) rather than the whole line — keeps line 2 in budget.
        GIT_SEG=$(fit_git $(( $(vis_width "$COST_SEG") + $(vis_width "$SEP") )))
    fi
    if [ -n "$GIT_SEG" ]; then
        if [ -n "$LINE2" ]; then LINE2="${LINE2}${SEP}${GIT_SEG}"; else LINE2="$GIT_SEG"; fi
    fi
    if [ -n "$LINE2" ]; then
        printf "%b\n%b\n" "$LINE1" "$LINE2"
    else
        printf "%b\n" "$LINE1"
    fi
fi
