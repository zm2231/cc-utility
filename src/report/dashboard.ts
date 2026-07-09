import type { OptimizationFinding } from "./optimizationRanking.js";
import type { DailySnapshot } from "../analyze/historySnapshot.js";
import type { JsonReport } from "./shared.js";

const CSS = `
:root{
  --surface:#faf9f7;--ink:#141310;--ink-2:#57554f;--ink-3:#94918a;--hairline:#e7e5e0;
  --accent:#2a78d6;--bad:#c73635;--warn:#b57c00;--track:#efede9;--raise:#ffffff;
}
@media (prefers-color-scheme: dark){:root{
  --surface:#181817;--ink:#f4f3f0;--ink-2:#b8b6af;--ink-3:#807e77;--hairline:#33322f;
  --accent:#4a90e2;--bad:#e66767;--warn:#c98500;--track:#292927;--raise:#212120;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:inherit}
nav{position:sticky;top:0;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--hairline);z-index:10}
.nav-inner{max-width:880px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:4px;height:52px}
.brand{font-weight:650;font-size:14px;margin-right:20px;letter-spacing:-.01em}
.tab{border:none;background:none;font:inherit;font-size:13px;color:var(--ink-3);padding:6px 10px;border-radius:6px;cursor:pointer}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--ink);background:var(--track)}
.tab .n{font-size:11px;color:var(--ink-3);margin-left:4px}
main{max-width:880px;margin:0 auto;padding:36px 24px 80px}
h1{font-size:24px;font-weight:650;letter-spacing:-.015em;margin:0 0 4px}
.meta{color:var(--ink-3);font-size:12.5px;margin-bottom:36px}
h2{font-size:13px;font-weight:600;color:var(--ink-2);margin:44px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--hairline)}
h2:first-of-type{margin-top:0}
h2 .sum{font-weight:400;color:var(--ink-3);float:right;font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;margin:0 0 8px}
.tile-value{font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.15}
.tile-label{font-size:13px;color:var(--ink);font-weight:500;margin-top:2px}
.tile-sub{font-size:12px;color:var(--ink-3);margin-top:1px}
.alert{display:flex;align-items:baseline;gap:10px;padding:10px 14px;border-left:2px solid var(--bad);background:color-mix(in srgb,var(--bad) 5%,transparent);border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13.5px}
.alert .go{margin-left:auto;font-size:12px;color:var(--ink-3);white-space:nowrap;text-decoration:none}
.alert .go:hover{color:var(--ink)}
.healthline{color:var(--ink-2);font-size:13px;margin:10px 0 0}
.bar-row{display:grid;grid-template-columns:minmax(120px,40%) 1fr 72px;gap:12px;align-items:center;padding:5px 0}
.bar-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.bar-track{background:var(--track);border-radius:3px;height:8px}
.bar-fill{height:100%;border-radius:0 3px 3px 0;min-width:2px;background:var(--accent)}
.bar-value{text-align:right;font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--ink-2)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--ink-3);font-weight:500;text-align:left;padding:8px 12px 8px 0;border-bottom:1px solid var(--hairline)}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
td{padding:8px 12px 8px 0;border-bottom:1px solid var(--hairline);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
.muted{color:var(--ink-3)}
.pill{border-radius:99px;padding:1px 8px;font-size:10.5px;background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad);white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:10px;flex:none;vertical-align:baseline}
.dot-high{background:var(--bad)}.dot-medium{background:var(--warn)}.dot-low{background:var(--ink-3)}
.finding{padding:12px 0;border-bottom:1px solid var(--hairline)}
.finding:last-child{border-bottom:none}
.finding-head{display:flex;align-items:baseline;font-size:14px;cursor:pointer}
.finding-detail{color:var(--ink-2);font-size:13px;margin:6px 0 0 18px;display:none}
.finding.open .finding-detail{display:block}
.finding-detail pre{background:transparent;border:none;border-left:2px solid var(--hairline);border-radius:0;padding:4px 0 4px 12px;margin:8px 0 0;font-size:11px;opacity:.65;overflow-x:auto;max-height:200px}
.empty{color:var(--ink-3);font-size:13px}
.hint{color:var(--ink-3);font-size:12px;margin:8px 0 0}
.more-btn{border:none;background:none;font:inherit;font-size:12px;color:var(--ink-3);cursor:pointer;padding:8px 0}
.more-btn:hover{color:var(--ink)}
.linewrap{position:relative;margin-top:10px}
.linechart .grid{stroke:var(--hairline);stroke-width:1}
.linechart .axis{fill:var(--ink-3);font-size:10px}
.linechart .line{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linejoin:round}
.linechart .area{fill:var(--accent);opacity:.07}
.linechart .line.secondary{stroke:var(--ink-3);stroke-width:1.2;opacity:.4;stroke-dasharray:2 4}
.crosshair{stroke:var(--ink-3);stroke-dasharray:3 3}
.tooltip{position:absolute;background:var(--raise);border:1px solid var(--hairline);border-radius:8px;padding:7px 10px;font-size:11.5px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.10);min-width:140px}
.legend{display:flex;gap:16px;font-size:12px;color:var(--ink-2);margin-top:8px}
.legend-item{display:flex;align-items:center;gap:6px}
.sw{width:14px;height:3px;border-radius:2px;background:var(--accent);display:inline-block}
.sw.secondary{background:var(--ink-3);opacity:.5}
.seg{display:inline-flex;gap:2px;background:var(--track);border-radius:7px;padding:2px}
.seg button{border:none;background:none;font:inherit;font-size:12px;color:var(--ink-3);padding:3px 10px;border-radius:5px;cursor:pointer}
.seg button.on{background:var(--raise);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.chart-controls{display:flex;gap:10px;justify-content:flex-end;margin:-38px 0 10px}
.heatwrap{position:relative;margin-top:10px;overflow-x:auto}
.heat rect{rx:2px}
.heat .lv0{fill:var(--track)}
.heat .lv1{fill:#9ec5f4}.heat .lv2{fill:#5598e7}.heat .lv3{fill:#256abf}.heat .lv4{fill:#104281}
@media (prefers-color-scheme: dark){.heat .lv1{fill:#184f95}.heat .lv2{fill:#1c5cab}.heat .lv3{fill:#3987e5}.heat .lv4{fill:#86b6ef}}
.heat text{fill:var(--ink-3);font-size:9px}
.band{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:12px 0 6px}
.band .fixed{background:var(--ink-3);opacity:.45}
.band .yours{background:var(--accent)}
.bandlegend{display:flex;gap:16px;font-size:12px;color:var(--ink-2)}
.bandlegend .sw2{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:-1px}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:40px}
@media(max-width:680px){.cols2{grid-template-columns:1fr}.tiles{gap:16px}}
footer{max-width:880px;margin:0 auto;padding:0 24px 40px;color:var(--ink-3);font-size:11.5px}
`;

const APP_JS = `
var DATA = JSON.parse(document.getElementById('report-data').textContent);
var R = DATA.report, FINDINGS = DATA.findings, HISTORY = DATA.history;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtC(n){n=Number(n)||0;if(n>=1e9)return (n/1e9).toFixed(1)+'B';if(n>=1e6)return (n/1e6).toFixed(1)+'M';if(n>=1e3)return (n/1e3).toFixed(1)+'K';return String(Math.round(n))}
function fmtN(n){return Math.round(Number(n)||0).toLocaleString('en-US')}
function pct(n){return ((Number(n)||0)*100).toFixed(1)+'%'}
function shortTool(t){var m=/^mcp__(.+?)__(.+)$/.exec(t);return m?m[1]+'.'+m[2]:t}

function tile(label,value,sub){return '<div class="tile"><div class="tile-value">'+esc(value)+'</div><div class="tile-label">'+esc(label)+'</div>'+(sub?'<div class="tile-sub">'+esc(sub)+'</div>':'')+'</div>'}

function barList(rows,cap){
  cap=cap||8;
  if(!rows.length)return '<p class="empty">No data.</p>';
  var max=Math.max.apply(null,rows.map(function(r){return r.share}).concat([1e-9]));
  function render(list){return list.map(function(r){return '<div class="bar-row"><div class="bar-label" title="'+esc(r.label)+'">'+esc(r.label)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+((r.share/max)*100).toFixed(1)+'%"></div></div><div class="bar-value">'+esc(r.value)+'</div></div>'}).join('')}
  var out=render(rows.slice(0,cap));
  if(rows.length>cap){
    var id='m'+Math.random().toString(36).slice(2);
    out+='<div id="'+id+'" style="display:none">'+render(rows.slice(cap))+'</div><button class="more-btn" data-more="'+id+'" data-n="'+(rows.length-cap)+'">show '+(rows.length-cap)+' more</button>';
  }
  return out;
}

function tableHtml(headers,rows,numeric,cap){
  cap=cap||8;
  if(!rows.length)return '<p class="empty">Nothing recorded.</p>';
  numeric=numeric||{};
  var head='<tr>'+headers.map(function(h,i){return '<th'+(numeric[i]?' class="num"':'')+'>'+esc(h)+'</th>'}).join('')+'</tr>';
  function cellHtml(c){return (c&&typeof c==='object'&&c.html!==undefined)?c.html:esc(c)}
  function render(list){return list.map(function(r){return '<tr>'+r.map(function(c,i){return '<td'+(numeric[i]?' class="num"':'')+'>'+cellHtml(c)+'</td>'}).join('')+'</tr>'}).join('')}
  var out='<table><thead>'+head+'</thead><tbody>'+render(rows.slice(0,cap))+'</tbody></table>';
  if(rows.length>cap){
    var id='t'+Math.random().toString(36).slice(2);
    out+='<div id="'+id+'" style="display:none"><table><tbody>'+render(rows.slice(cap))+'</tbody></table></div><button class="more-btn" data-more="'+id+'" data-n="'+(rows.length-cap)+'">show '+(rows.length-cap)+' more</button>';
  }
  return out;
}

function lineChart(series,unit){
  var width=832,height=190,pad={l:46,r:12,t:12,b:24};
  var all=[];series.forEach(function(s){all=all.concat(s.points)});
  if(all.length<2)return '<p class="empty">Not enough history yet.</p>';
  var xs=[];all.forEach(function(p){if(xs.indexOf(p.x)<0)xs.push(p.x)});xs.sort();
  var maxY=Math.max.apply(null,all.map(function(p){return p.y}).concat([1e-9]));
  var plotW=width-pad.l-pad.r,plotH=height-pad.t-pad.b;
  function px(x){return pad.l+(xs.indexOf(x)/Math.max(1,xs.length-1))*plotW}
  function py(y){return pad.t+plotH-(y/maxY)*plotH}
  var grid=[0.5,1].map(function(f){var y=py(maxY*f);return '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(width-pad.r)+'" y2="'+y+'" class="grid"/><text x="'+(pad.l-6)+'" y="'+(y+3)+'" text-anchor="end" class="axis">'+esc(fmtC(maxY*f))+'</text>'}).join('');
  var paths=series.map(function(s,si){
    var pts=s.points.map(function(p){return px(p.x).toFixed(1)+','+py(p.y).toFixed(1)}).join(' ');
    var area='';
    if(si===0&&s.points.length){
      var first=s.points[0],last=s.points[s.points.length-1];
      area='<polygon class="area" points="'+px(first.x).toFixed(1)+','+(height-pad.b)+' '+pts+' '+px(last.x).toFixed(1)+','+(height-pad.b)+'"/>';
    }
    return area+'<polyline points="'+pts+'" class="line'+(s.secondary?' secondary':'')+'"/>';
  }).join('');
  var legend=series.length>=2?'<div class="legend">'+series.map(function(s){return '<span class="legend-item"><span class="sw'+(s.secondary?' secondary':'')+'"></span>'+esc(s.name)+'</span>'}).join('')+'</div>':'';
  var cfg={xs:xs,unit:unit||'',pad:pad,width:width,series:series.map(function(s){return {name:s.name,ys:xs.map(function(x){var f=null;s.points.forEach(function(p){if(p.x===x)f=p.y});return f})}})};
  return '<div class="linewrap" data-line="'+esc(JSON.stringify(cfg))+'"><svg viewBox="0 0 '+width+' '+height+'" width="100%" preserveAspectRatio="none" class="linechart">'+grid+paths+'<line class="crosshair" x1="0" y1="'+pad.t+'" x2="0" y2="'+(height-pad.b)+'" style="display:none"/><text x="'+pad.l+'" y="'+(height-6)+'" class="axis">'+esc(xs[0])+'</text><text x="'+(width-pad.r)+'" y="'+(height-6)+'" text-anchor="end" class="axis">'+esc(xs[xs.length-1])+'</text></svg><div class="tooltip" style="display:none"></div></div>'+legend;
}

function wireCharts(root){
  root.querySelectorAll('.linewrap').forEach(function(wrap){
    var cfg=JSON.parse(wrap.getAttribute('data-line'));
    var svg=wrap.querySelector('svg'),tip=wrap.querySelector('.tooltip'),cross=wrap.querySelector('.crosshair');
    var plotW=cfg.width-cfg.pad.l-cfg.pad.r;
    svg.addEventListener('mousemove',function(ev){
      var rect=svg.getBoundingClientRect();
      var fx=(ev.clientX-rect.left)/rect.width*cfg.width;
      var i=Math.round((fx-cfg.pad.l)/plotW*(cfg.xs.length-1));
      if(i<0||i>=cfg.xs.length){tip.style.display='none';cross.style.display='none';return}
      var x=cfg.pad.l+i/Math.max(1,cfg.xs.length-1)*plotW;
      cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.style.display='';
      var lines=['<b>'+esc(cfg.xs[i])+'</b>'];
      cfg.series.forEach(function(s){if(s.ys[i]!==null)lines.push(esc(s.name)+': '+Number(s.ys[i]).toLocaleString()+cfg.unit)});
      tip.innerHTML=lines.join('<br>');tip.style.display='';
      var lx=ev.clientX-rect.left+12;if(lx>rect.width-180)lx=rect.width-180;
      tip.style.left=lx+'px';tip.style.top='4px';
    });
    svg.addEventListener('mouseleave',function(){tip.style.display='none';cross.style.display='none'});
  });
  root.querySelectorAll('.finding-head').forEach(function(h){
    h.addEventListener('click',function(){h.parentElement.classList.toggle('open')});
  });
}

function findingRow(f){
  return '<div class="finding"><div class="finding-head"><span class="dot dot-'+esc(f.severity)+'"></span><span>'+esc(f.headline)+'</span></div><div class="finding-detail"><p>'+esc(f.detail)+'</p><pre>'+esc(JSON.stringify(f.evidence,null,2))+'</pre></div></div>';
}

var chartState={source:'all',view:'line'};

function dailySeries(){
  var byDate={};
  HISTORY.forEach(function(h){
    byDate[h.date]=byDate[h.date]||{claudeOut:0,claudeIn:0,claudeCacheW:0,codexIn:0,codexOut:0};
    byDate[h.date].claudeOut=h.totalOutput;byDate[h.date].claudeIn=h.totalInput;byDate[h.date].claudeCacheW=h.totalCacheCreation;
  });
  ((R.codex&&R.codex.daily)||[]).forEach(function(d){
    byDate[d.date]=byDate[d.date]||{claudeOut:0,claudeIn:0,claudeCacheW:0,codexIn:0,codexOut:0};
    byDate[d.date].codexIn=d.input;byDate[d.date].codexOut=d.output;
  });
  return Object.keys(byDate).sort().map(function(date){var v=byDate[date];v.date=date;return v});
}

function heatmap(days){
  if(days.length<2)return '<p class="empty">Not enough history yet.</p>';
  var cell=12,gap=3,step=cell+gap;
  var vals=days.map(function(d){return d.v});
  var maxV=Math.max.apply(null,vals.concat([1]));
  var byDate={};days.forEach(function(d){byDate[d.date]=d});
  var start=new Date(days[0].date+'T00:00:00Z');
  start.setUTCDate(start.getUTCDate()-start.getUTCDay());
  var end=new Date(days[days.length-1].date+'T00:00:00Z');
  var totalDays=Math.round((end-start)/86400000)+1;
  var weeks=Math.max(1,Math.ceil(totalDays/7));
  var width=weeks*step,height=7*step+16;
  var rects='',monthLabels='',lastMonth='';
  for(var i=0;i<weeks*7;i++){
    var d=new Date(start.getTime()+i*86400000);
    if(d>end)break;
    var ds=d.toISOString().slice(0,10);
    var entry=byDate[ds];
    var v=entry?entry.v:0;
    var lv=0;
    if(v>0){var t=Math.log(1+v)/Math.log(1+maxV);lv=1+Math.min(3,Math.floor(t*4))}
    var week=Math.floor(i/7),day=i%7;
    rects+='<rect class="lv'+lv+'" data-d="'+esc(ds)+'" x="'+(week*step)+'" y="'+(day*step)+'" width="'+cell+'" height="'+cell+'"/>';
    if(day===0){var m=d.toISOString().slice(5,7);if(m!==lastMonth){lastMonth=m;monthLabels+='<text x="'+(week*step)+'" y="'+(7*step+11)+'">'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+'</text>'}}
  }
  return '<div class="heatwrap"><svg class="heat" viewBox="0 0 '+width+' '+height+'" width="100%" style="max-width:'+width+'px">'+rects+monthLabels+'</svg><div class="tooltip" style="display:none"></div></div>';
}

function wireHeatmap(root){
  root.querySelectorAll('.heatwrap').forEach(function(wrap){
    var tip=wrap.querySelector('.tooltip');
    var data={};dailySeries().forEach(function(d){data[d.date]=d});
    wrap.querySelectorAll('rect').forEach(function(r){
      r.addEventListener('mousemove',function(ev){
        var ds=r.getAttribute('data-d');var d=data[ds];
        var lines=['<b>'+esc(ds)+'</b>'];
        if(d){
          if(chartState.source!=='codex')lines.push('Claude: '+fmtC(d.claudeOut)+' out · '+fmtC(d.claudeIn)+' in · '+fmtC(d.claudeCacheW)+' cache-write');
          if(chartState.source!=='claude')lines.push('Codex: '+fmtC(d.codexOut)+' out · '+fmtC(d.codexIn)+' in');
        } else lines.push('no activity');
        tip.innerHTML=lines.join('<br>');tip.style.display='';
        var rect=wrap.getBoundingClientRect();
        var lx=ev.clientX-rect.left+14;
        lx=Math.max(4,Math.min(lx,rect.width-tip.offsetWidth-8));
        var ly=ev.clientY-rect.top-tip.offsetHeight-10;
        if(ly<0)ly=ev.clientY-rect.top+16;
        tip.style.left=lx+'px';tip.style.top=ly+'px';
      });
      r.addEventListener('mouseleave',function(){tip.style.display='none'});
    });
  });
}

function dailyChartHtml(){
  var days=dailySeries().slice(-365);
  function val(d){
    if(chartState.source==='claude')return {out:d.claudeOut,inp:d.claudeIn};
    if(chartState.source==='codex')return {out:d.codexOut,inp:d.codexIn};
    return {out:d.claudeOut+d.codexOut,inp:d.claudeIn+d.codexIn};
  }
  if(chartState.view==='heat'){
    var firstClaude=HISTORY.length?HISTORY[0].date:null;
    var cxDaily=(R.codex&&R.codex.daily)||[];
    var firstCodex=cxDaily.length?cxDaily[0].date:null;
    var cover=[];
    if(firstClaude)cover.push('Claude Code data since '+firstClaude+' (older transcripts are no longer on disk)');
    if(firstCodex)cover.push('Codex since '+firstCodex);
    return heatmap(days.map(function(d){var v=val(d);return {date:d.date,v:v.out+v.inp}}))
      +(cover.length?'<p class="hint">'+esc(cover.join(' · '))+'</p>':'');
  }
  var recent=days.slice(-90);
  return lineChart([
    {name:'output tokens / day',points:recent.map(function(d){return {x:d.date,y:val(d).out}})},
    {name:'input tokens / day',secondary:true,points:recent.map(function(d){return {x:d.date,y:val(d).inp}})}
  ]);
}

function chartControls(){
  function seg(key,opts){
    return '<div class="seg">'+opts.map(function(o){return '<button data-k="'+key+'" data-v="'+o[0]+'" class="'+(chartState[key]===o[0]?'on':'')+'">'+o[1]+'</button>'}).join('')+'</div>';
  }
  return '<div class="chart-controls">'+seg('source',[['all','All'],['claude','Claude'],['codex','Codex']])+seg('view',[['line','Line'],['heat','Days']])+'</div>';
}

function wireChartControls(root){
  root.querySelectorAll('.chart-controls button').forEach(function(b){
    b.addEventListener('click',function(){
      chartState[b.getAttribute('data-k')]=b.getAttribute('data-v');
      var host=document.getElementById('daily-chart');
      host.innerHTML=chartControls()+dailyChartHtml();
      wireCharts(host);wireHeatmap(host);wireChartControls(host);
    });
  });
}

function viewHome(){
  var co=R.contextOverhead,q=R.officialQuota,cx=R.codex;
  var high=FINDINGS.filter(function(f){return f.severity==='high'}).slice(0,3);
  var alerts=high.map(function(f){return '<div class="alert"><span>'+esc(f.headline)+'</span><a class="go" href="#optimizations">details →</a></div>'}).join('');
  var failing=R.toolFriction.filter(function(r){return r.errorRate>=0.3}).length;
  var slowHooks=R.hooks.rows.filter(function(r){return r.slow}).length;
  var health='Cache '+pct(R.tokens.cacheHitRate)+' · '+(failing?failing+' tools failing':'tools healthy')+' · '+(slowHooks?slowHooks+' slow hooks':'hooks healthy')+' · '+fmtN(R.compaction.staleContextSessions.length)+' stale live sessions';
  return '<h1>Your coding agents</h1><div class="meta">'+fmtN(R.sessionsScanned)+' Claude Code sessions'+(cx?' · '+fmtN(cx.sessions)+' Codex sessions':'')+' · generated '+esc(DATA.generatedAt)+' · 100% local</div>'
    +(alerts?alerts+'':'')
    +'<h2>Usage</h2><div class="tiles">'
    +tile('Output tokens',fmtC(R.tokens.totalOutput),pct(R.sidechain.outputShare)+' via subagents')
    +tile('Context before turn 1',fmtC(co.medianFirstTurnTokens),'tokens · median')
    +tile('Median turn wait',(R.turnDuration.medianMs/1000).toFixed(0)+'s','p95 '+(R.turnDuration.p95Ms/1000).toFixed(0)+'s')
    +tile('Prompts',fmtC(R.promptPatterns.realPromptCount),pct(R.promptPatterns.questionShare)+' questions')
    +(q&&q.five_hour?tile('Quota now',q.five_hour.utilization+'%',q.seven_day?'5h · weekly '+q.seven_day.utilization+'%':'5h window'):'')
    +'</div><p class="healthline">'+esc(health)+'</p>'
    +'<h2>Daily tokens</h2><div id="daily-chart">'+chartControls()+dailyChartHtml()+'</div>';
}

function viewOptimizations(){
  if(!FINDINGS.length)return '<h1>Optimizations</h1><p class="empty">Nothing crossed a threshold. Your harness looks healthy.</p>';
  var groups=[['high','Fix now'],['medium','Worth doing'],['low','Minor']];
  var out='<h1>Optimizations</h1><div class="meta">'+FINDINGS.length+' ranked improvements, biggest measured impact first. Click one for evidence.</div>';
  groups.forEach(function(g){
    var list=FINDINGS.filter(function(f){return f.severity===g[0]});
    if(!list.length)return;
    out+='<h2>'+g[1]+'<span class="sum">'+list.length+'</span></h2>'+list.map(findingRow).join('');
  });
  return out;
}

var HARNESS_BASELINE_EST=13000;

function fixedVsYours(){
  var co=R.contextOverhead;
  var median=co.medianFirstTurnTokens||0;
  if(!median)return '';
  var fixed=Math.min(HARNESS_BASELINE_EST,median);
  var yours=Math.max(0,median-fixed);
  return '<h2>Fixed vs yours<span class="sum">median first-turn context</span></h2>'
    +'<div class="band"><div class="fixed" style="width:'+((fixed/median)*100).toFixed(1)+'%"></div><div class="yours" style="width:'+((yours/median)*100).toFixed(1)+'%"></div></div>'
    +'<div class="bandlegend"><span><span class="sw2" style="background:var(--ink-3);opacity:.45"></span>Harness baseline ~'+fmtC(fixed)+' tok (est.): Claude Code\\'s system prompt + built-in tools; cannot be reduced</span>'
    +'<span><span class="sw2" style="background:var(--accent)"></span>Your configuration ~'+fmtC(yours)+' tok: skills, agents, CLAUDE.md, MCP names, hooks, memory</span></div>'
    +'<p class="hint">Your lightest sessions run '+fmtC(co.p5FirstTurnTokens||0)+' tok (5th percentile); heavy projects reach '+fmtC(co.p90FirstTurnTokens||0)+' tok (90th). The gap between those is per-project configuration.</p>';
}

function viewClaude(){
  var models=Object.entries(R.modelMix).sort(function(a,b){return b[1]-a[1]}).map(function(e){return {label:e[0],value:fmtN(e[1]),share:e[1]}});
  var tools=Object.entries(R.toolCalls).sort(function(a,b){return b[1]-a[1]}).map(function(e){return {label:shortTool(e[0]),value:fmtN(e[1]),share:e[1]}});
  var attr=R.contextAttribution;
  var attrRows=attr?attr.items.map(function(i){return {label:i.component,value:fmtC(i.estTokens)+' tok',share:i.estTokens}}):[];
  var frictionRows=R.toolFriction.filter(function(r){return r.errorRate>=0.3}).map(function(r){return [shortTool(r.tool),(r.errorRate*100).toFixed(0)+'%',r.errors+'/'+r.results]});
  var denialRows=R.denials.topPatterns.map(function(r){return [r.pattern,fmtN(r.count),{html:'<span class="muted">'+esc(Object.entries(r.kinds).map(function(e){return e[0]+' ×'+e[1]}).join(', '))+'</span>'}]});
  var hookRows=R.hooks.rows.map(function(r){return [{html:esc(r.hook)+(r.timeouts?' <span class="pill">'+Number(r.timeouts)+' timeouts</span>':'')},fmtN(r.count),fmtN(r.medianMs)+'ms',(r.totalWaitMs/60000).toFixed(1)+'min']});
  var skills=Object.entries(R.skillsInvokedByModel).sort(function(a,b){return b[1]-a[1]}).map(function(e){return {label:e[0],value:fmtN(e[1]),share:e[1]}});
  var slashes=Object.entries(R.slashCommandsTyped).sort(function(a,b){return b[1]-a[1]}).map(function(e){return {label:'/'+e[0],value:fmtN(e[1]),share:e[1]}});
  return '<h1>Claude Code</h1><div class="meta">'+fmtN(R.sessionsScanned)+' sessions · '+fmtC(R.tokens.totalOutput)+' output tokens</div>'
    +'<h2>Context health<span class="sum">'+fmtC(R.contextOverhead.medianFirstTurnTokens)+' tok before turn 1 · '+fmtN(R.compaction.totalCompactions)+' compactions</span></h2>'
    +'<div class="tiles">'
    +tile('Before turn 1',fmtC(R.contextOverhead.medianFirstTurnTokens),'tokens · median of '+fmtN(R.contextOverhead.sessionsCounted)+' fresh sessions')
    +tile('Compaction keeps',pct(R.compactionRetention.medianRetainedFraction),'median retained')
    +tile('Reclaimed',fmtC(R.compaction.tokensReclaimed),'tokens via compaction')
    +tile('Stale live sessions',fmtN(R.compaction.staleContextSessions.length),'active <7d, uncompacted growth')
    +'</div>'
    +fixedVsYours()
    +'<h2>What loads before turn one</h2>'+barList(attrRows)+(attr?'<p class="hint">'+esc(attr.note)+'</p>':'')
    +(attr&&attr.claudeMdByProject.length?'<h2>CLAUDE.md weight by project</h2>'+barList(attr.claudeMdByProject.map(function(p){return {label:p.cwd.split('/').slice(-2).join('/'),value:fmtC(p.estTokens)+' tok',share:p.estTokens}}))+'<p class="hint">Total CLAUDE.md tokens a session in that project loads (project file plus any ancestor-directory files).</p>':'')
    +'<div class="cols2"><div><h2>Model mix</h2>'+barList(models)+'</div><div><h2>Tool calls</h2>'+barList(tools)+'</div></div>'
    +'<h2>Failing tools</h2>'+tableHtml(['Tool','Fail rate','n'],frictionRows,{1:1,2:1})
    +'<h2>Permission denials</h2>'+tableHtml(['Pattern','Denied','Kind'],denialRows,{1:1})
    +'<h2>Hook latency</h2>'+tableHtml(['Hook','Firings','Median','Total wait'],hookRows,{1:1,2:1,3:1})
    +'<p class="hint">Hook counts are floors: successful runs with empty output are never persisted to transcripts.</p>'
    +'<div class="cols2"><div><h2>Skills the model invoked</h2>'+barList(skills)+'</div><div><h2>Slash commands you typed</h2>'+barList(slashes)+'</div></div>';
}

var rlState={days:90};

function rlChartHtml(){
  var cx=R.codex;
  var series=cx.rateLimits.series||[];
  if(rlState.days){
    var cutoff=Date.now()-rlState.days*86400000;
    series=series.filter(function(s){return s.ts>=cutoff});
  }
  var controls='<div class="chart-controls"><div class="seg">'+[[30,'30d'],[90,'90d'],[0,'All']].map(function(o){return '<button data-days="'+o[0]+'" class="'+(rlState.days===o[0]?'on':'')+'">'+o[1]+'</button>'}).join('')+'</div></div>';
  var rlx=function(s){return new Date(s.ts).toISOString().slice(0,13).replace('T',' ')+'h'};
  var chart=series.length>=2?lineChart([
    {name:'5-hour window %',points:series.filter(function(s){return s.primaryPct!==null}).map(function(s){return {x:rlx(s),y:s.primaryPct}})},
    {name:'weekly window %',secondary:true,points:series.filter(function(s){return s.secondaryPct!==null}).map(function(s){return {x:rlx(s),y:s.secondaryPct}})}
  ],'%'):'<p class="empty">No rate-limit samples in this range.</p>';
  return controls+chart;
}

function wireRlControls(root){
  root.querySelectorAll('#rl-chart .chart-controls button').forEach(function(b){
    b.addEventListener('click',function(){
      rlState.days=Number(b.getAttribute('data-days'));
      var host=document.getElementById('rl-chart');
      host.innerHTML=rlChartHtml();
      wireCharts(host);wireRlControls(document);
    });
  });
}

function viewCodex(){
  var cx=R.codex;
  if(!cx)return '<h1>Codex</h1><p class="empty">No ~/.codex/sessions found (or scan skipped with --no-codex).</p>';
  var chart='<div id="rl-chart">'+rlChartHtml()+'</div>';
  var models=Object.entries(cx.models).map(function(e){return {label:e[0],value:fmtN(e[1]),share:e[1]}});
  var tools=Object.entries(cx.toolCalls).map(function(e){return {label:e[0],value:fmtN(e[1]),share:e[1]}});
  var execs=Object.entries(cx.execCommandHeads).map(function(e){return {label:e[0],value:fmtN(e[1]),share:e[1]}});
  return '<h1>Codex</h1><div class="meta">'+fmtN(cx.sessions)+' sessions · '+fmtN(cx.filesScanned)+' rollout files</div>'
    +'<h2>Usage</h2><div class="tiles">'
    +tile('Input tokens',fmtC(cx.tokens.totalInput),pct(cx.tokens.cacheShareOfInput)+' cached')
    +tile('Output tokens',fmtC(cx.tokens.totalOutput),fmtC(cx.tokens.totalReasoningOutput)+' reasoning')
    +tile('Turns completed',fmtN(cx.turnsCompleted),fmtN(cx.userMessages)+' user messages')
    +tile('Context fill at end',pct(cx.contextWindowFill.medianEndOfSessionFill),'median · p90 '+pct(cx.contextWindowFill.p90EndOfSessionFill))
    +'</div>'
    +'<h2>Rate-limit utilization<span class="sum">peaks: 5h '+cx.rateLimits.peakPrimaryPct+'% · weekly '+cx.rateLimits.peakSecondaryPct+'%</span></h2>'+chart
    +'<div class="cols2"><div><h2>Models</h2>'+barList(models)+'</div><div><h2>Tools</h2>'+barList(tools)+'</div></div>'
    +'<h2>Shell commands</h2>'+barList(execs);
}

function viewProjects(){
  var rows=R.projects.map(function(r){return [{html:'<span title="'+esc(r.cwd)+'">'+esc(r.cwd.split('/').slice(-2).join('/'))+'</span>'},fmtC(r.output),fmtC(r.toolCalls),fmtN(r.sessions)]});
  var cxRows=R.codex?Object.entries(R.codex.workspaces).map(function(e){return [{html:'<span title="'+esc(e[0])+'">'+esc(e[0].split('/').slice(-2).join('/'))+'</span>'},fmtN(e[1])]}):[];
  return '<h1>Projects</h1><div class="meta">'+fmtN(R.workspaceCount)+' workspaces seen · '+pct(R.sidechain.outputShare)+' of output produced by subagents</div>'
    +'<h2>Claude Code<span class="sum">by output tokens</span></h2>'+tableHtml(['Project','Output','Tool calls','Sessions'],rows,{1:1,2:1,3:1},12)
    +(cxRows.length?'<h2>Codex<span class="sum">by sessions</span></h2>'+tableHtml(['Project','Sessions'],cxRows,{1:1},12):'');
}

var VIEWS={home:viewHome,optimizations:viewOptimizations,claude:viewClaude,codex:viewCodex,projects:viewProjects};
function route(){
  var tab=(location.hash||'#home').slice(1);
  if(!VIEWS[tab])tab='home';
  var main=document.getElementById('app');
  main.innerHTML=VIEWS[tab]();
  wireCharts(main);wireHeatmap(main);wireChartControls(main);wireRlControls(main);
  document.querySelectorAll('.tab').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===tab)});
  window.scrollTo(0,0);
}
document.addEventListener('click',function(ev){
  var b=ev.target.closest?ev.target.closest('.more-btn'):null;
  if(!b)return;
  var d=document.getElementById(b.getAttribute('data-more'));
  if(!d)return;
  var hidden=d.style.display==='none';
  d.style.display=hidden?'':'none';
  b.textContent=hidden?'show fewer':'show '+b.getAttribute('data-n')+' more';
});
window.addEventListener('hashchange',route);
document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){location.hash='#'+b.getAttribute('data-tab')})});
route();
`;

export function buildDashboard(report: JsonReport, findings: OptimizationFinding[], history: DailySnapshot[]): string {
  const data = {
    generatedAt: new Date().toISOString().slice(0, 10),
    report,
    findings,
    history: history.slice(-370),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const optCount = findings.length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cc-utility</title><style>${CSS}</style></head>
<body>
<nav><div class="nav-inner">
  <span class="brand">cc-utility</span>
  <button class="tab" data-tab="home">Home</button>
  <button class="tab" data-tab="optimizations">Optimizations${optCount ? `<span class="n">${optCount}</span>` : ""}</button>
  <button class="tab" data-tab="claude">Claude Code</button>
  <button class="tab" data-tab="codex">Codex</button>
  <button class="tab" data-tab="projects">Projects</button>
</div></nav>
<main id="app"></main>
<footer>Deterministic stats from local session logs. No telemetry. The only network call is the optional --quota check against Anthropic's official endpoint; Codex rate-limit history comes from Codex's own rollout files.</footer>
<script id="report-data" type="application/json">${json}</script>
<script>${APP_JS}</script>
</body></html>`;
}
