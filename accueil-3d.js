/* RoutineSite : les 3 scènes de l'accueil en 3D (SVG + petit moteur de projection, sans bibliothèque). */
(function(){
const F=600, D=600, NS='http://www.w3.org/2000/svg';
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const f1=v=>Math.round(v*10)/10;
const L=(()=>{const v=[-.45,.75,.55],n=Math.hypot(...v);return v.map(a=>a/n)})();

function rot(p,c){const x1=p[0]*c.cy+p[2]*c.sy, z1=-p[0]*c.sy+p[2]*c.cy;return [x1,p[1]*c.cp-z1*c.sp,p[1]*c.sp+z1*c.cp];}
function proj(v,c){const s=F/(D-v[2]);return [c.x+v[0]*s,c.y-v[1]*s,s];}
const pts=P=>P.map(p=>f1(p[0])+','+f1(p[1])).join(' ');
function mix(a,b,k){return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*k)).join(',')+')';}

/* primitives */
function ring(r,y,n,a0,a1,fn){const o=[];for(let i=0;i<=n;i++){const a=a0+(a1-a0)*i/n;o.push(fn?fn(r,a):[r*Math.cos(a),y,r*Math.sin(a)]);}return o;}
function segs(P,st,k){const o=[];k=k||1;for(let i=0;i<P.length-1;i+=k)o.push(Object.assign({t:'l',p:P.slice(i,Math.min(i+k,P.length-1)+1)},st));return o;}
function box(x,z,w,h,y0,col,alpha,edge){
  const a=w/2,y1=y0+h,o=[];
  const V=(dx,dy,dz)=>[x+dx,dy,z+dz];
  const faces=[
    [[0,1,0],[V(-a,y1,-a),V(a,y1,-a),V(a,y1,a),V(-a,y1,a)]],
    [[1,0,0],[V(a,y0,-a),V(a,y0,a),V(a,y1,a),V(a,y1,-a)]],
    [[-1,0,0],[V(-a,y0,-a),V(-a,y1,-a),V(-a,y1,a),V(-a,y0,a)]],
    [[0,0,1],[V(-a,y0,a),V(-a,y1,a),V(a,y1,a),V(a,y0,a)]],
    [[0,0,-1],[V(-a,y0,-a),V(a,y0,-a),V(a,y1,-a),V(-a,y1,-a)]]];
  for(const [n,p] of faces)o.push({t:'f',p,n,col,alpha,edge,top:n[1]===1});
  return o;
}

function Scene(svg,cfg){
  this.svg=svg;this.cfg=cfg;this.yaw=0;this.uy=0;this.up=0;this.hy=0;this.hp=0;this.thy=0;this.thp=0;
  this.g=document.createElementNS(NS,'g');svg.appendChild(this.g);
  if(cfg.over){const o=document.createElementNS(NS,'g');o.innerHTML=cfg.over;svg.appendChild(o);}
  this.static=cfg.build();
  let drag=null;this.moved=false;
  svg.style.touchAction='pan-y';svg.style.cursor='grab';
  svg.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,uy:this.uy,up:this.up};this.moved=false;svg.style.cursor='grabbing';});
  window.addEventListener('pointerup',()=>{if(drag){drag=null;svg.style.cursor='grab';}});
  svg.addEventListener('pointermove',e=>{
    const r=svg.getBoundingClientRect();
    if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)this.moved=true;
      this.uy=drag.uy+dx*.012;this.up=Math.max(-.35,Math.min(.5,drag.up+dy*.006));}
    else{this.thy=((e.clientX-r.left)/r.width-.5)*.7;this.thp=((e.clientY-r.top)/r.height-.5)*.35;}
  });
  svg.addEventListener('pointerleave',()=>{this.thy=0;this.thp=0;});
  svg.addEventListener('click',e=>{if(this.moved){e.stopPropagation();e.preventDefault();this.moved=false;}},true);
}
Scene.prototype.frame=function(t){
  const c=this.cfg;
  this.hy+=(this.thy-this.hy)*.08;this.hp+=(this.thp-this.hp)*.08;
  const yaw=(RM?0:c.auto(t))+this.uy+this.hy+(c.yaw0||0), pit=c.pitch+this.up+this.hp;
  const C={cy:Math.cos(yaw),sy:Math.sin(yaw),cp:Math.cos(pit),sp:Math.sin(pit),x:c.cx,y:c.cy};
  const prims=this.static.concat(c.dyn?c.dyn(RM?0:t):[]);
  const items=[];
  for(const pr of prims){
    const V=pr.p.map(p=>rot(p,C));
    let d=0;for(const v of V)d+=v[2];d/=V.length;d+=(pr.b||0);
    let k=1;
    if(pr.n){const n=rot(pr.n,C),cx=V.reduce((s,v)=>s+v[0],0)/V.length,cy=V.reduce((s,v)=>s+v[1],0)/V.length,cz=V.reduce((s,v)=>s+v[2],0)/V.length;
      if(n[0]*(0-cx)+n[1]*(0-cy)+n[2]*(D-cz)<=0)continue;
      k=Math.max(0,n[0]*L[0]+n[1]*L[1]+n[2]*L[2]);}
    items.push({pr,V,d,k});
  }
  items.sort((a,b)=>a.d-b.d);
  let o='';
  for(const it of items){
    const pr=it.pr,P=it.V.map(v=>proj(v,C));
    if(pr.t==='f'){
      const fill=pr.flat?mix([10,12,18],pr.col,.45+.55*it.k):pr.top?mix(pr.col,[255,255,255],.35+.4*it.k):mix([4,20,40],pr.col,.35+.65*it.k);
      o+=`<polygon points="${pts(P)}" fill="${fill}" fill-opacity="${pr.alpha}"${pr.edge?` stroke="${pr.edge}" stroke-width=".7" stroke-opacity=".8"`:''} stroke-linejoin="round"/>`;
    }else if(pr.t==='poly'){
      o+=`<polygon points="${pts(P)}" fill="${pr.fill}"${pr.op!=null?` opacity="${pr.op}"`:''}${pr.s?` stroke="${pr.s}" stroke-opacity="${pr.so||1}"`:''}/>`;
    }else if(pr.t==='l'){
      const s=P[0][2];
      o+=`<polyline points="${pts(P)}" fill="none" stroke="${pr.s}" stroke-opacity="${pr.o==null?1:pr.o}" stroke-width="${f1((pr.w||1)*s*100)/100}" stroke-linecap="round"${pr.da?` stroke-dasharray="${pr.da}"`:''}${pr.fl?` filter="url(#${pr.fl})"`:''}/>`;
    }else if(pr.t==='b'){
      const p=P[0],r=f1(pr.r*p[2]);
      o+=`<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}" fill="${pr.fill}"${pr.s?` stroke="${pr.s}" stroke-width="${pr.sw||1.5}"`:''}${pr.op!=null?` opacity="${pr.op}"`:''}${pr.fl?` filter="url(#${pr.fl})"`:''}/>`;
      if(pr.lab)o+=`<text x="${f1(p[0])}" y="${f1(p[1]+4*p[2])}" font-size="${f1(11*p[2])}" fill="${pr.lc||'#ffe0e7'}"${pr.lw?` font-weight="${pr.lw}"`:''} text-anchor="middle" font-family="JetBrains Mono,monospace">${pr.lab}</text>`;
    }else if(pr.t==='cap'){
      const s=(P[0][2]+P[1][2])/2,ln=pts(P);
      o+=`<polyline points="${ln}" stroke="${pr.c1}" stroke-width="${f1(pr.r*2*s)}" stroke-linecap="round" fill="none"/><polyline points="${ln}" stroke="${pr.c2}" stroke-width="${f1(pr.r*1.3*s)}" stroke-linecap="round" fill="none" opacity="${pr.o2||.8}"/>`;
      if(pr.c3){const n=pr.k||5,ax=P[1][0]-P[0][0],ay=P[1][1]-P[0][1],L2=Math.hypot(ax,ay)||1,nx=-ay/L2,ny=ax/L2,w=pr.r*.75*s;let z='';
      for(let i=0;i<=n*2;i++){const t=i/(n*2),sg=i%2?1:-1;z+=f1(P[0][0]+ax*t+nx*w*sg)+','+f1(P[0][1]+ay*t+ny*w*sg)+' ';}
      o+=`<polyline points="${z}" stroke="${pr.c3}" stroke-width="${f1(1.1*s)}" fill="none" stroke-linejoin="round" opacity=".85"/>`;}
    }else if(pr.t==='tx'){
      const p=P[0];
      o+=`<text x="${f1(p[0])}" y="${f1(p[1])}" font-size="${f1(pr.fs*p[2])}" fill="${pr.fill}" text-anchor="${pr.a||'middle'}" font-family="${pr.ff||'Inter,Arial,sans-serif'}"${pr.fw?` font-weight="${pr.fw}"`:''}${pr.op!=null?` opacity="${pr.op}"`:''}>${pr.s}</text>`;
    }
  }
  this.g.innerHTML=o;
};


const tilt=(p,ax,ay)=>{let[x,y,z]=p;const y1=y*Math.cos(ax)-z*Math.sin(ax),z1=y*Math.sin(ax)+z*Math.cos(ax);return[x*Math.cos(ay)+z1*Math.sin(ay),y1,-x*Math.sin(ay)+z1*Math.cos(ay)];};
const FY=-90;
const rotYv=(p,a)=>[p[0]*Math.cos(a)+p[2]*Math.sin(a),p[1],-p[0]*Math.sin(a)+p[2]*Math.cos(a)];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
/* pavé orienté : c centre, h demi-côtés, R rotation des décalages */
function obox(c,h,R,col,alpha,extra){
  R=R||(p=>p);const o=[],[a,b,d]=h;
  const F=[[[1,0,0],[[a,-b,-d],[a,-b,d],[a,b,d],[a,b,-d]]],[[-1,0,0],[[-a,-b,-d],[-a,b,-d],[-a,b,d],[-a,-b,d]]],
    [[0,1,0],[[-a,b,-d],[a,b,-d],[a,b,d],[-a,b,d]]],[[0,-1,0],[[-a,-b,-d],[-a,-b,d],[a,-b,d],[a,-b,-d]]],
    [[0,0,1],[[-a,-b,d],[-a,b,d],[a,b,d],[a,-b,d]]],[[0,0,-1],[[-a,-b,-d],[a,-b,-d],[a,b,-d],[-a,b,-d]]]];
  for(const [n,P] of F)o.push(Object.assign({t:'f',p:P.map(p=>add(c,R(p))),n:R(n),col:hex(col),alpha:alpha==null?1:alpha,flat:true},extra||{}));
  return o;
}
function floor(r,grad,col){
  const o=[{t:'poly',p:ring(r,FY,64,0,2*Math.PI),fill:`url(#${grad})`,b:-3000}];
  o.push(...segs(ring(r+4,FY,96,0,2*Math.PI),{s:col,o:.4,w:1,b:-2900,da:'2 6'},96));
  for(const rr of [40,80])o.push(...segs(ring(rr,FY,64,0,2*Math.PI),{s:col,o:.12,w:.8,b:-2950},64));
  return o;
}
/* un élève stylisé : tête, cheveux, buste, bras, jambes */
function eleve(x,z,ang,col,o){
  o=o||{};const W=p=>add(rotYv(p,ang),[x,0,z]),L=hex(col),c2=mix(L,[255,255,255],.35);
  const out=[],sea=o.assis,hipY=sea?-55:-45;
  const cap=(a,b,r,c1,c2b)=>out.push({t:'cap',p:[W(a),W(b)],r,c1,c2:c2b,o2:.55});
  for(const s of [-1,1]){
    if(sea){cap([s*6,hipY,2],[s*7,hipY,26],6,'#2b3242','#4a5468');cap([s*7,hipY,26],[s*7,FY+4,28],5.5,'#2b3242','#4a5468');}
    else cap([s*6,hipY,0],[s*7,FY+5,o.pas?s*6:0],6,'#2b3242','#4a5468');
  }
  cap([0,hipY+8,0],[0,-2,0],13,col,c2);
  const mains=o.mains||[[-16,-38,4],[16,-38,4]];
  mains.forEach((m,i)=>{const s=i?1:-1;cap([s*14,-2,0],m,4.5,col,c2);out.push({t:'b',p:[W(m)],r:4,fill:'url(#rPeau)'});});
  out.push({t:'b',p:[W([0,24,-3.5])],r:12.8,fill:'#2b2118'});
  out.push({t:'b',p:[W([0,21,0])],r:12,fill:'url(#rPeau)'});
  return out;
}
/* dé : cube tourné, avec ses points */
const PIPS={1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]]};
function de(c,s,ax,ay){
  const R=p=>rotYv(tilt(p,ax,0),ay),h=s/2,o=obox(c,[h,h,h],R,'#e8eeff',1);
  const fc=[[[0,1,0],1,[1,0,0],[0,0,1]],[[0,-1,0],6,[1,0,0],[0,0,1]],[[1,0,0],2,[0,1,0],[0,0,1]],[[-1,0,0],5,[0,1,0],[0,0,1]],[[0,0,1],3,[1,0,0],[0,1,0]],[[0,0,-1],4,[1,0,0],[0,1,0]]];
  for(const [n,v,u,w] of fc)for(const [a,b] of PIPS[v]){const p=[0,1,2].map(j=>n[j]*(h+.6)+u[j]*a*s*.27+w[j]*b*s*.27);o.push({t:'b',p:[add(c,R(p))],r:s*.075,fill:'#1d2a55',n:R(n)});}
  return o;
}

/* ---------- 1. Probabilités ---------- */
function probas(){
  const o=floor(118,'rFloorB','#7aa2ff');
  const B=[1,6,15,20,15,6,1];
  B.forEach((v,i)=>o.push(...obox([-8+i*17,FY+v*2,-58],[6.5,v*2,6.5],null,i===3?'#bcd0ff':'#7aa2ff',.92)));
  const P=[];for(let i=0;i<=36;i++){const x=-8+i*102/36,k=(x+8)/17-3;P.push([x,FY+40*Math.exp(-k*k/3)+10,-58]);}
  o.push(...segs(P,{s:'#dfe8ff',o:.7,w:1.4},3));
  o.push({t:'tx',p:[[43,FY+64,-58]],s:'n = 6, p = ½',fs:10,fill:'#cfdcff',ff:'ui-monospace,Menlo,monospace',b:3000});
  o.push(...eleve(-62,18,1.05,'#7aa2ff',{mains:[[-14,-36,8],[14,26,18]],pas:1}));
  return o;
}
function probasDyn(t){
  const o=[];
  [[0,0],[.5,1]].forEach(([d,k])=>{
    let u=((t*.32+d)%1);const fly=Math.min(1,u/.7);
    const x=-46+(k?70:96)*fly,z=18-30*fly*(k?1.2:.6),y=Math.max(FY+10,-18+70*Math.sin(Math.PI*fly)*(1-fly*.35)-90*fly*fly*.55);
    const sp=u<.7?u*14:9.8;
    o.push(...de([x,y,z],20,sp*.9+k,sp*1.3+k*2));
  });
  o.push({t:'tx',p:[[34,52,10]],s:'P(6) = 1/6',fs:12,fw:600,fill:'#e8eeff',b:3000});
  return o;
}
/* ---------- 2. Technologie ---------- */
const CODE=[[0,'#5fc98a',.7],[1,'#e6e6e6',.55],[1,'#7aa2ff',.8],[2,'#e6e6e6',.45],[1,'#5fc98a',.6],[0,'#ffcf6b',.5]];
function techno(){
  const o=floor(118,'rFloorG','#5fc98a');
  o.push(...obox([22,-46,0],[44,3,40],null,'#3a4150'));
  for(const [x,z] of [[-18,-34],[-18,34],[62,-34],[62,34]])o.push(...obox([x,(FY-49)/2,z],[2.5,(-49-FY)/2,2.5],null,'#2a2f3a'));
  o.push(...obox([14,-41,0],[17,2,25],null,'#9aa3b2'));
  o.push(...obox([12,-38.6,0],[11,.4,20],null,'#2a2f3a'));
  const tl=.32,hx=31,H=38,top=[hx+H*Math.sin(tl),-39+H*Math.cos(tl)];
  const S=(f,zz)=>[hx+(top[0]-hx)*f,-39+(top[1]+39)*f,zz];
  o.push({t:'f',p:[S(0,-25),S(1,-25),S(1,25),S(0,25)],n:[-Math.cos(tl),Math.sin(tl),0],col:hex('#0c1f16'),alpha:1,flat:true,b:-1});
  o.push({t:'f',p:[S(0,-25),S(0,25),S(1,25),S(1,-25)].map(p=>[p[0]+1.2,p[1],p[2]]),n:[Math.cos(tl),-Math.sin(tl),0],col:hex('#9aa3b2'),alpha:1,flat:true});
  CODE.forEach(([ind,c,len],i)=>{const f=.82-i*.13,a=S(f,-20+ind*5),b=S(f,-20+ind*5+38*len);o.push({t:'l',p:[[a[0]-.6,a[1],a[2]],[b[0]-.6,b[1],b[2]]],s:c,o:.95,w:2.2,b:3});});
  o.push(...obox([-46,-60,0],[11,2,11],null,'#4a5468'),...obox([-46,(FY-62)/2,0],[2.5,(-62-FY)/2,2.5],null,'#2a2f3a'));
  o.push(...eleve(-46,0,Math.PI/2,'#5fc98a',{assis:1,mains:[[-9,-37,40],[9,-37,40]]}));
  return o;
}
const NET=Array.from({length:7},(_,i)=>{const a=i/7*2*Math.PI;return [Math.cos(a)*66,78+12*Math.sin(3*a),Math.sin(a)*66];});
const NE=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0],[0,3],[1,5],[2,6]];
function technoDyn(t){
  const a=t*.35,N=NET.map(p=>rotYv(p,a)),o=[];
  NE.forEach(([i,j],k)=>{o.push({t:'l',p:[N[i],N[j]],s:'#5fc98a',o:.45,w:1.2});const u=(t*.6+k*.29)%1;o.push({t:'b',p:[[N[i][0]+(N[j][0]-N[i][0])*u,N[i][1]+(N[j][1]-N[i][1])*u,N[i][2]+(N[j][2]-N[i][2])*u]],r:1.8,fill:'#d7ffe6'});});
  N.forEach((p,i)=>o.push({t:'b',p:[p],r:i===0?7:5,fill:'url(#rNoeud)',s:'#5fc98a',sw:1}));
  ['1011','0x2A','IP','01'].forEach((s,i)=>{const b=a*.7+i*Math.PI/2;o.push({t:'tx',p:[[Math.cos(b)*100,20+8*Math.sin(t+i),Math.sin(b)*100]],s,fs:11,fill:'#a8f0c6',op:.8,ff:'ui-monospace,Menlo,monospace'});});
  o.push({t:'l',p:[[0,-30,0],[0,40,0]].map(p=>rotYv(p,0)),s:'#5fc98a',o:.15,w:1,da:'2 4'});
  return o;
}
/* ---------- 3. L'orateur ---------- */
function orateur(){
  const o=floor(118,'rFloorR','#ff6b6b');
  o.push(...obox([0,FY+3,-12],[62,3,34],null,'#3a2a30'));
  const T=13;for(let i=0;i<T;i++){const a=i/T*2*Math.PI,b=(i+1)/T*2*Math.PI;o.push({t:'poly',p:[[0,118,-14],[34*Math.cos(a),FY+7,-12+26*Math.sin(a)],[34*Math.cos(b),FY+7,-12+26*Math.sin(b)]],fill:'#ffe3e3',op:.05,b:-2500});}
  o.push({t:'poly',p:ring(34,0,40,0,2*Math.PI,(r,a)=>[r*Math.cos(a),FY+6.5,-12+26*Math.sin(a)]),fill:'#ffd6d6',op:.12,b:-2400});
  o.push(...eleve(0,-14,0,'#ff6b6b',{mains:[[-10,-34,18],[26,8,20]]}));
  o.push(...obox([0,-62,8],[17,27,10],null,'#b8434f'));
  o.push(...obox([0,-33,11],[21,2,14],p=>tilt(p,-.25,0),'#ff8a8a'));
  o.push({t:'l',p:[[6,-31,18],[3,2,16]],s:'#1b1d24',o:1,w:2});
  o.push({t:'b',p:[[3,4,16]],r:3.6,fill:'#2b2f3a',s:'#9aa3b2',sw:.8});
  for(let r=0;r<2;r++)for(let i=0;i<5;i++){const a=-.6+i*.3,R=92+r*20,x=Math.sin(a)*R,z=-12+Math.cos(a)*R;
    o.push({t:'cap',p:[[x,FY+4,z],[x,FY+16,z]],r:7,c1:'#2c3140',c2:'#454d62',o2:.5},{t:'b',p:[[x,FY+26,z]],r:5.5,fill:'#3b2f2a'});}
  return o;
}
const MOTS=['clarté','rythme','voix','regard','silence','conviction'];
function orateurDyn(t){
  const o=[],M=[0,22,-6];
  for(let k=0;k<3;k++){const r=12+((t*26+k*24)%72),op=Math.max(0,.75*(1-r/86));
    const P=[],Q=[];for(let i=0;i<=14;i++){const a=-.9+1.8*i/14;P.push([M[0]+r*Math.sin(a),M[1],M[2]+r*Math.cos(a)]);Q.push([M[0],M[1]+r*Math.sin(a)*.8,M[2]+r*Math.cos(a)]);}
    o.push(...segs(P,{s:'#ff9b9b',o:op,w:1.6},2),...segs(Q,{s:'#ff9b9b',o:op*.7,w:1.2},2));}
  MOTS.forEach((s,i)=>{const b=t*.28+i/MOTS.length*2*Math.PI;o.push({t:'tx',p:[[Math.cos(b)*80,62+10*Math.sin(t*.8+i),-12+Math.sin(b)*60]],s,fs:12,fw:500,fill:'#ffd0d0',op:.85});});
  return o;
}

const DEFS={
probas:`<radialGradient id="rFloorB"><stop offset="0" stop-color="#7aa2ff" stop-opacity=".4"/><stop offset="1" stop-color="#7aa2ff" stop-opacity=".03"/></radialGradient>`,
techno:`<radialGradient id="rFloorG"><stop offset="0" stop-color="#5fc98a" stop-opacity=".35"/><stop offset="1" stop-color="#5fc98a" stop-opacity=".03"/></radialGradient>
<radialGradient id="rNoeud" cx=".35" cy=".3"><stop offset="0" stop-color="#e9fff1"/><stop offset=".5" stop-color="#5fc98a"/><stop offset="1" stop-color="#1d5a3a"/></radialGradient>`,
orateur:`<radialGradient id="rFloorR"><stop offset="0" stop-color="#ff6b6b" stop-opacity=".35"/><stop offset="1" stop-color="#ff6b6b" stop-opacity=".03"/></radialGradient>`};
const PEAU='<radialGradient id="rPeau" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffe2c8"/><stop offset=".6" stop-color="#e9b48c"/><stop offset="1" stop-color="#9a6a48"/></radialGradient>';
const CFG={
  probas:{build:probas,dyn:probasDyn,pitch:.36,cx:180,cy:168,yaw0:-.35,auto:t=>.45*Math.sin(t*.3)},
  techno:{build:techno,dyn:technoDyn,pitch:.36,cx:180,cy:172,yaw0:.3,auto:t=>.4*Math.sin(t*.27)},
  orateur:{build:orateur,dyn:orateurDyn,pitch:.34,cx:180,cy:172,auto:t=>.45*Math.sin(t*.25)}
};
const scenes=[];
document.querySelectorAll('svg[data-3d]').forEach(svg=>{
  const k=svg.getAttribute('data-3d');
  const d=document.createElementNS(NS,'defs');d.innerHTML=DEFS[k]+PEAU;svg.insertBefore(d,svg.firstChild);
  scenes.push(new Scene(svg,CFG[k]));
});
const t0=performance.now();let vis=true;
document.addEventListener('visibilitychange',()=>{vis=!document.hidden;});
function loop(now){if(vis){const t=Math.max(0,(now-t0)/1000);for(const s of scenes){const r=s.svg.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)s.frame(t);}}requestAnimationFrame(loop);}
scenes.forEach(s=>s.frame(0));requestAnimationFrame(loop);
})();
