/**
 * Phase 8 baseline: draw calls / triangles per dive point (with and without the shadow pass),
 * creature breakdown, textures, programs, canvas size. Usage: node scripts/probe-phase8-baseline.cjs [dist/artifact.html]
 * Headless SwiftShader barely advances the main loop, so the scene is populated by stepping the updates by hand
 * (see RESUME.md). Render timings are not meaningful under SwiftShader and are not used for budgets.
 */
const http=require('http'),fs=require('fs');
const {chromium}=require('playwright');
const FILE=process.argv[2]||require('path').join(__dirname,'..','dist','artifact.html');
(async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(FILE));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true});
 const errs=[];page.on('pageerror',e=>errs.push(String(e)));
 const t0=Date.now();
 await page.goto(url);
 await page.waitForFunction(()=>window.__THREE_GAME_TEST_HOOKS__,null,{timeout:120000});
 console.log('hooks after ms',Date.now()-t0, JSON.stringify(await page.evaluate(()=>window.__BOOT_MS__)));
 await page.evaluate(()=>{const b=document.getElementById('pr-go'); if(b) b.click();});
 await page.waitForTimeout(1500);
 await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__.setState('title'));
 const out={};
 for(const pl of ['lagoon','reef','rocky','wall','offshore','kelp','ruins','deep']){
  await page.evaluate(p=>window.__THREE_GAME_TEST_HOOKS__.setState(p),pl);
  await page.waitForTimeout(500);
  const r=await page.evaluate(async(pl)=>{
   const h=window.__THREE_GAME_TEST_HOOKS__,g=h.game;
   g.tut&&(g.tut.step=-1);
   g.paused=false;
   // force population: run creature updates; build budget off
   g.creatures.buildBudgetMs=1e9;
   const cp=g.camera.position, dir=g.camera.getWorldDirection(new g.camera.position.constructor());
   let bt=performance.now();
   for(let i=0;i<40;i++){ g.updateDiver(0.05); const d=g.camera.getWorldDirection(new cp.constructor()); g.creatures.update(0.05,cp,g.vel,d); g.flora.update(cp,g.time); g.terrain.update(cp.x,cp.z,g.terrain.radius,1);}
   const simMs=(performance.now()-bt)/40;
   g.env.update(0.05,g.camera,g.renderer,g.time);
   g.renderer.info.autoReset=false; g.renderer.info.reset();
   g.renderer.shadowMap.needsUpdate=true;
   let t=performance.now(); g.renderer.render(g.scene,g.camera); const withShadowMs=performance.now()-t;
   const i1={calls:g.renderer.info.render.calls,tris:g.renderer.info.render.triangles};
   g.renderer.info.reset(); g.renderer.shadowMap.needsUpdate=false;
   t=performance.now(); g.renderer.render(g.scene,g.camera); const noShadowMs=performance.now()-t;
   const i2={calls:g.renderer.info.render.calls,tris:g.renderer.info.render.triangles};
   g.renderer.info.autoReset=true;
   // creature breakdown
   let crCalls=0,crTris=0,crInst=0,crSpecies=0; const top=[];
   for(const rt of g.creatures.list){ if(!rt.mesh||!rt.mesh.visible||rt.mesh.count===0) continue; crSpecies++; const geo=rt.mesh.geometry; const tri=(geo.index?geo.index.count:geo.attributes.position.count)/3; crCalls++; crInst+=rt.mesh.count; crTris+=tri*rt.mesh.count; top.push([rt.def.id,Math.round(tri),rt.mesh.count]); }
   top.sort((a,b)=>b[1]*b[2]-a[1]*a[2]);
   const built=g.creatures.list.filter(r=>r.mesh).length;
   return {pl,simMs:+simMs.toFixed(1),withShadow:{...i1,ms:+withShadowMs.toFixed(0)},noShadow:{...i2,ms:+noShadowMs.toFixed(0)},draw:h.drawStats(),cr:{species:crSpecies,inst:crInst,tris:Math.round(crTris),built,top:top.slice(0,6)},tex:g.renderer.info.memory.textures,geos:g.renderer.info.memory.geometries,progs:g.renderer.info.programs.length,dpr:g.renderer.getPixelRatio(),canvas:[g.renderer.domElement.width,g.renderer.domElement.height]};
  },pl);
  console.log(JSON.stringify(r));
 }
 // texture memory estimate
 const tm=await page.evaluate(()=>{const g=window.__THREE_GAME_TEST_HOOKS__.game; const seen=new Set(); let bytes=0,n=0; const list=[];
  g.scene.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[]; for(const m of ms) for(const k of ['map','normalMap','roughnessMap','aoMap','emissiveMap','alphaMap']){const t=m[k]; if(!t||seen.has(t.uuid)) continue; seen.add(t.uuid); const im=t.image; const w=im?.width||0,h=im?.height||0; const b=w*h*4*(t.generateMipmaps!==false?1.33:1); bytes+=b;n++; list.push([o.name||o.type,k,w,h]);}});
  const env=g.scene.environment; return {n,MB:+(bytes/1048576).toFixed(1),big:list.filter(x=>x[2]*x[3]>=512*512).map(x=>x.join(':')).slice(0,30)};});
 console.log('texmem',JSON.stringify(tm));
 console.log('errors',errs.slice(0,3));
 await browser.close(); server.close();
})();
