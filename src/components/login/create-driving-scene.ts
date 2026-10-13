import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ThemeTransition, type Theme, type LightPhase } from './theme-transition';

export type View = 'home' | 'login';
export interface SceneOptions { theme: Theme; view: View; reducedMotion: boolean; paused: boolean; onReady: () => void; onViewSettled: (view: View) => void; onProgress: (value: number) => void; onError: (message: string) => void; onPhase: (phase: LightPhase, lamps: number) => void; }
export interface SceneController { setTheme: (theme: Theme) => void; setView: (view: View) => void; setPaused: (paused: boolean) => void; setReducedMotion: (reduced: boolean) => void; dispose: () => void; }

function radialTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64,64,2,64,64,64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.28, 'rgba(255,255,255,.75)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(canvas);
}

function ribbonGeometry(curve: THREE.CatmullRomCurve3, width: number) {
  const samples = 320, vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i=0; i<=samples; i++) {
    const t=i/samples, point=curve.getPointAt(t), tangent=curve.getTangentAt(t);
    const side = new THREE.Vector3(tangent.z,0,-tangent.x).normalize().multiplyScalar(width/2);
    vertices.push(point.x-side.x,point.y,point.z-side.z, point.x+side.x,point.y,point.z+side.z);
    uvs.push(t,0,t,1);
    if (i<samples) { const k=i*2; indices.push(k,k+1,k+2,k+1,k+3,k+2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

export function createDrivingScene(container: HTMLDivElement, options: SceneOptions): SceneController {
  let disposed=false, paused=options.paused, reduced=options.reducedMotion;
  let modelPrepared=false, readyNotified=false;
  const abort = new AbortController();
  const scene = new THREE.Scene();
  const lightBackground = new THREE.Color('#f7f9fc'), darkBackground = new THREE.Color('#111923');
  scene.background = lightBackground.clone(); scene.fog = new THREE.Fog(lightBackground, 24, 80);
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 110);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.08;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '同一辆 3D 概念车，流动轨道与延迟灯光');
  renderer.domElement.setAttribute('role', 'img'); container.appendChild(renderer.domElement);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment,.025);
  scene.environment=environmentTarget.texture; environment.dispose(); pmrem.dispose();
  scene.environmentIntensity=1.1;

  const groundMaterial = new THREE.MeshBasicMaterial({color:lightBackground,toneMapped:false,fog:false});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(180,180),groundMaterial); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const ambient = new THREE.HemisphereLight('#eaf1ff','#8795a7',2.2); scene.add(ambient);
  const key=new THREE.DirectionalLight('#ffffff',3.2); key.position.set(4,9,7); key.castShadow=true;
  key.shadow.mapSize.set(2048,2048); key.shadow.camera.left=-7; key.shadow.camera.right=7; key.shadow.camera.top=7; key.shadow.camera.bottom=-7; key.shadow.camera.near=.5; key.shadow.camera.far=30; key.shadow.bias=-.00035; key.shadow.normalBias=.015; scene.add(key);
  const rim=new THREE.DirectionalLight('#c1d5fc',2); rim.position.set(-5,4,-7); scene.add(rim);
  const fill=new THREE.DirectionalLight('#e7efff',1.4); fill.position.set(-5,2,6); scene.add(fill);

  const carGroup=new THREE.Group(); carGroup.name='PersistentCar'; scene.add(carGroup);
  const frontMaterials: THREE.MeshStandardMaterial[] = [], rearMaterials: THREE.MeshStandardMaterial[] = [];
  const wheels: THREE.Object3D[] = [];
  const wheelAxis=new THREE.Vector3(1,0,0);
  const glowTexture=radialTexture();
  const contactShadowMaterial=new THREE.MeshBasicMaterial({color:'#172031',map:glowTexture,transparent:true,opacity:.3,depthWrite:false,toneMapped:false});
  const contactShadow=new THREE.Mesh(new THREE.PlaneGeometry(3.8,6.5),contactShadowMaterial);contactShadow.rotation.x=-Math.PI/2;contactShadow.position.set(0,.008,0);scene.add(contactShadow);
  const realShadow=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.16}));realShadow.rotation.x=-Math.PI/2;realShadow.position.y=.004;realShadow.receiveShadow=true;scene.add(realShadow);
  const underGlowMaterial=new THREE.MeshBasicMaterial({color:'#1176ff',map:glowTexture,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const underGlow=new THREE.Mesh(new THREE.PlaneGeometry(3.8,6.3),underGlowMaterial); underGlow.rotation.x=-Math.PI/2; underGlow.position.y=.016; carGroup.add(underGlow);
  const stripMaterial=new THREE.MeshBasicMaterial({color:'#3f9fff',transparent:true,opacity:0,depthWrite:false,toneMapped:false});
  for (const x of [-.87,.87]) { const strip=new THREE.Mesh(new THREE.BoxGeometry(.024,.02,2.5),stripMaterial); strip.position.set(x,.12,-.04); carGroup.add(strip); }
  const headSpots: THREE.SpotLight[]=[];
  const pools: THREE.MeshBasicMaterial[]=[];
  for (const x of [-.7,.7]) {
    const head=new THREE.SpotLight('#d7e9ff',0,11,.33,.9,1.4); head.position.set(x,.55,2.03); head.target.position.set(x*1.3,.02,7.2); carGroup.add(head,head.target); headSpots.push(head);
    const mat=new THREE.MeshBasicMaterial({color:'#c2deff',map:glowTexture,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(1.8,5.2),mat); pool.rotation.x=-Math.PI/2; pool.position.set(x,.019,4.35); carGroup.add(pool); pools.push(mat);
  }
  const underLight=new THREE.PointLight('#1379ff',0,4,2); underLight.position.set(0,.25,0); carGroup.add(underLight);

  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-7,.028,-23),new THREE.Vector3(-2.4,.028,-13),new THREE.Vector3(-.12,.028,-4),new THREE.Vector3(.02,.028,3),new THREE.Vector3(1.5,.028,10),new THREE.Vector3(7,.028,22)]);
  const trackMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uDark:{value:0}},vertexShader:
    'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:
    'varying vec2 vUv; uniform float uTime; uniform float uDark; void main(){float p=fract(vUv.x*62.+uTime*1.9);float dash=1.-smoothstep(.32,.4,p);float focus=pow(max(0.,sin(vUv.x*18.-uTime*.18)),14.);vec3 base=mix(vec3(.47,.51,.57),vec3(.055,.33,.72),uDark);vec3 col=mix(base,vec3(.075,.38,.96),focus*.85);float edge=1.-smoothstep(.25,.5,abs(vUv.y-.5));float fade=smoothstep(0.,.06,vUv.x)*(1.-smoothstep(.93,1.,vUv.x));gl_FragColor=vec4(col,(.12+dash*.6+focus*.12)*edge*fade);}'
  });
  scene.add(new THREE.Mesh(ribbonGeometry(curve,.09),trackMaterial));
  const trackGlowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,uniforms:{uTime:trackMaterial.uniforms.uTime,uDark:trackMaterial.uniforms.uDark},vertexShader:trackMaterial.vertexShader,fragmentShader:
    'varying vec2 vUv;uniform float uTime;uniform float uDark;void main(){float crossFade=pow(1.-abs(vUv.y-.5)*2.,3.);float p=pow(max(0.,sin(vUv.x*45.+uTime*1.2)),12.);float edge=smoothstep(0.,.08,vUv.x)*(1.-smoothstep(.88,1.,vUv.x));gl_FragColor=vec4(.02,.24,.8,crossFade*(.08+p*.2)*uDark*edge);}'
  });
  scene.add(new THREE.Mesh(ribbonGeometry(curve,.45),trackGlowMaterial));

  const motion={view:options.view==='login'?1:0,parallaxX:0,parallaxY:0};
  const themes=new ThemeTransition(options.theme,reduced);
  let width=1,height=1,driveTime=0,prev=performance.now(), lastPhase='',lastLamp=-1;
  const framePosition=new THREE.Vector3(), frameLook=new THREE.Vector3();
  const colors=new THREE.Color();
  const resize=()=>{ const size=container.getBoundingClientRect(); width=Math.max(1,size.width);height=Math.max(1,size.height);renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix(); };
  const observer=new ResizeObserver(resize); observer.observe(container);resize();
  const onPointer=(e:PointerEvent)=>{if(reduced)return;const x=(e.clientX/window.innerWidth-.5),y=(e.clientY/window.innerHeight-.5);gsap.to(motion,{parallaxX:x*.7,parallaxY:y*.28,duration:1.2,overwrite:'auto',ease:'power2.out'});};
  window.addEventListener('pointermove',onPointer,{passive:true});
  const resetPointer=()=>gsap.to(motion,{parallaxX:0,parallaxY:0,duration:1.2,ease:'power2.out',overwrite:'auto'});
  document.documentElement.addEventListener('pointerleave',resetPointer);
  const onLost=(e:Event)=>{e.preventDefault(); if(!disposed)options.onError('3D 场景暂时不可用；登录演示仍可使用。请刷新重试。');};
  renderer.domElement.addEventListener('webglcontextlost',onLost);

  async function loadModel() {
    try {
      const response=await fetch('/models/concept-car.glb',{signal:abort.signal}); if(!response.ok)throw new Error('model '+response.status);
      const total=Number(response.headers.get('content-length'))||11778688;
      const reader=response.body?.getReader(); const chunks:Uint8Array[]=[]; let loaded=0;
      if(reader){while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);loaded+=value.length;if(!disposed)options.onProgress(Math.min(95,Math.round(loaded/total*95)));}}
      const bytes = reader ? new Uint8Array(loaded) : new Uint8Array(await response.arrayBuffer());
      let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const gltf=await new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer,'/models/');
      if(disposed){disposeTree(gltf.scene);return;}
      const car=gltf.scene;
      const seen=new Set<THREE.Material>();
      car.traverse(object=>{
        if(/^Wheel(Front|Rear)[LR]$/.test(object.name)) { object.quaternion.identity(); wheels.push(object); }
        if(!(object instanceof THREE.Mesh))return;
        object.castShadow=true;object.receiveShadow=true;
        if(/License|Emblem/.test(object.name))object.visible=false;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        for(const mat of materials){
          if(seen.has(mat))continue;seen.add(mat);
          if(!(mat instanceof THREE.MeshStandardMaterial))continue;
          mat.envMapIntensity=1.25;
          if(mat.name.startsWith('Paint 1')) {mat.color.set('#a3adbd');mat.normalScale.set(0,0);mat.metalness=.85;mat.roughness=.26;if(mat instanceof THREE.MeshPhysicalMaterial){mat.clearcoat=1;mat.clearcoatRoughness=.18;mat.iridescence=0;}}
          if(mat.name.startsWith('Paint 2')){mat.color.set('#4c596c');mat.normalScale.set(0,0);mat.metalness=.7;mat.roughness=.3;}
          if(mat.name==='Glass'){mat.color.set('#172530');mat.metalness=.2;mat.roughness=.13;mat.envMapIntensity=1.8;if(mat instanceof THREE.MeshPhysicalMaterial){mat.transmission=0;mat.clearcoat=1;mat.clearcoatRoughness=.05;}mat.transparent=false;mat.opacity=1;}
          if(mat.name.startsWith('Interior'))mat.color.set('#17212d');
          if(mat.name==='Headlight'){mat.emissive.set('#d3e6ff');mat.emissiveIntensity=0;frontMaterials.push(mat);}
          else if(mat.name==='Brakelight'){mat.emissiveIntensity=0;rearMaterials.push(mat);}
          else if(mat.name==='Signallight'||mat.name==='Dashboard')mat.emissiveIntensity=0;
        }
      });
      car.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(car); const size=box.getSize(new THREE.Vector3()); const length=Math.max(size.z,size.x);
      car.scale.multiplyScalar(4.9/length);car.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(car);const center=box.getCenter(new THREE.Vector3());
      car.position.set(-center.x,-box.min.y+.028,-center.z);carGroup.add(car);
      container.dataset.model=car.uuid;container.dataset.modelSource='CarConcept';container.dataset.loadCount='1';container.dataset.headlightMaterials=String(frontMaterials.length);
      await renderer.compileAsync(scene,camera);
      if(disposed)return;options.onProgress(100);modelPrepared=true;
    }catch(error){if(disposed || (error instanceof Error&&error.name==='AbortError'))return;console.error('Car scene failed',error);options.onError('模型加载失败，请刷新重试。登录演示不受影响。');}
  }
  void loadModel();

  const frame=(now:number)=>{
    if(disposed)return;
    const delta=Math.min((now-prev)/1000,.045);prev=now;
    if(document.hidden)return;
    if(!paused&&!reduced){driveTime+=delta;wheels.forEach(w=>w.rotateOnWorldAxis(wheelAxis,delta*1.2));}
    const theme=themes.sample(now);const night=theme.environment;
    colors.copy(lightBackground).lerp(darkBackground,night);(scene.background as THREE.Color).copy(colors);(scene.fog as THREE.Fog).color.copy(colors);groundMaterial.color.copy(colors);
    ambient.intensity=THREE.MathUtils.lerp(2.2,.62,night);key.intensity=THREE.MathUtils.lerp(3.2,1.55,night);rim.intensity=THREE.MathUtils.lerp(2,2.3,night);fill.intensity=THREE.MathUtils.lerp(1.4,.8,night);
    scene.environmentIntensity=THREE.MathUtils.lerp(1.0,.48,night);
    const lamp=theme.lamps;contactShadowMaterial.opacity=THREE.MathUtils.lerp(.3,.6,night);
    frontMaterials.forEach(m=>m.emissiveIntensity=lamp*9);rearMaterials.forEach(m=>m.emissiveIntensity=lamp*.7);
    headSpots.forEach(s=>s.intensity=lamp*54);pools.forEach(m=>m.opacity=lamp*.24);underGlowMaterial.opacity=lamp*.58;stripMaterial.opacity=lamp;underLight.intensity=lamp*1.7;
    trackMaterial.uniforms.uTime.value=driveTime;trackMaterial.uniforms.uDark.value=night;
    carGroup.position.y=(reduced?0:Math.sin(driveTime*2.2)*.004);carGroup.rotation.z=reduced?0:Math.sin(driveTime*.72)*.0009;
    const v=motion.view,mobile=width<760;
    const zoom = mobile ? 1.7 : (width/height<1.4 ? 1.13 : 1);
    framePosition.set(THREE.MathUtils.lerp(6.4,6.9,v),THREE.MathUtils.lerp(7.3,3.9,v),THREE.MathUtils.lerp(8.4,8.7,v)).multiplyScalar(zoom);
    framePosition.x+=motion.parallaxX;framePosition.y+=motion.parallaxY;
    frameLook.set(0,.42,0);camera.position.copy(framePosition);camera.lookAt(frameLook);camera.updateProjectionMatrix();
    // Off-axis composition changes position on screen without swapping or stretching the car.
    camera.projectionMatrix.elements[8]=mobile?0:THREE.MathUtils.lerp(-.43,.4,v);
    camera.projectionMatrix.elements[9]=mobile?THREE.MathUtils.lerp(.36,-.58,v):-.015;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    container.dataset.lightPhase=theme.phase;container.dataset.lamps=lamp.toFixed(3);container.dataset.environment=night.toFixed(3);container.dataset.cameraView=v.toFixed(3);container.dataset.parallaxX=motion.parallaxX.toFixed(3);container.dataset.parallaxY=motion.parallaxY.toFixed(3);
    if(lastPhase!==theme.phase||Math.abs(lastLamp-lamp)>.24){lastPhase=theme.phase;lastLamp=lamp;options.onPhase(theme.phase,lamp);}
    renderer.render(scene,camera);
    if(modelPrepared&&!readyNotified){readyNotified=true;options.onReady();}
  };
  renderer.setAnimationLoop(frame);
  return {
    setTheme(theme){themes.setTarget(theme,performance.now());},
    setView(view){gsap.to(motion,{view:view==='login'?1:0,duration:reduced?.12:1.65,ease:'power3.inOut',overwrite:'auto',onComplete:()=>{if(!disposed)options.onViewSettled(view);}});},
    setPaused(value){paused=value;},
    setReducedMotion(value){reduced=value;themes.setReducedMotion(value);if(value){gsap.set(motion,{parallaxX:0,parallaxY:0});}},
    dispose(){if(disposed)return;disposed=true;abort.abort();gsap.killTweensOf(motion);observer.disconnect();window.removeEventListener('pointermove',onPointer);document.documentElement.removeEventListener('pointerleave',resetPointer);renderer.domElement.removeEventListener('webglcontextlost',onLost);renderer.setAnimationLoop(null);disposeTree(scene);environmentTarget.dispose();glowTexture.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}

function disposeTree(root:THREE.Object3D){
  const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),geometries=new Set<THREE.BufferGeometry>();
  root.traverse(object=>{if(!(object instanceof THREE.Mesh))return;geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
  materials.forEach(material=>{Object.values(material).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});material.dispose();});
  geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());
}

