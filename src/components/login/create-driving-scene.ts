import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ThemeTransition, type Theme, type LightPhase } from './theme-transition';

export type View = 'home' | 'login';
export interface SceneOptions { theme: Theme; view: View; reducedMotion: boolean; paused: boolean; onReady: () => void; onViewSettled: (view: View) => void; onProgress: (value: number) => void; onError: (message: string) => void; onPhase: (phase: LightPhase, lamps: number) => void; }
export interface SceneController { setTheme: (theme: Theme) => void; setStoryProgress: (progress: number) => void; setView: (view: View) => void; setPaused: (paused: boolean) => void; setReducedMotion: (reduced: boolean) => void; dispose: () => void; }

function radialTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64,64,2,64,64,64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.28, 'rgba(255,255,255,.75)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(canvas);
}

function ribbonGeometry(curve: THREE.Curve<THREE.Vector3>, width: number) {
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
  // Approved production composition: left-front wheel close-up.
  const frontWheelView=true;
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
  renderer.domElement.setAttribute('aria-hidden', 'true'); container.appendChild(renderer.domElement);
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

  const glowTexture=radialTexture();
  const contactShadowMaterial=new THREE.MeshBasicMaterial({color:'#172031',map:glowTexture,transparent:true,opacity:.3,depthWrite:false,toneMapped:false});
  const contactShadow=new THREE.Mesh(new THREE.PlaneGeometry(3.8,6.5),contactShadowMaterial);contactShadow.rotation.x=-Math.PI/2;contactShadow.position.set(0,.008,0);scene.add(contactShadow);
  const realShadow=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.16}));realShadow.rotation.x=-Math.PI/2;realShadow.position.y=.004;realShadow.receiveShadow=true;scene.add(realShadow);
  const underGlowMaterial=new THREE.MeshBasicMaterial({color:'#1176ff',map:glowTexture,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const underGlow=new THREE.Mesh(new THREE.PlaneGeometry(3.8,6.3),underGlowMaterial); underGlow.rotation.x=-Math.PI/2; underGlow.position.y=.016; carGroup.add(underGlow);
  const stripMaterial=new THREE.MeshBasicMaterial({color:'#3f9fff',transparent:true,opacity:0,depthWrite:false,toneMapped:false});
  for (const x of [-.87,.87]) { const strip=new THREE.Mesh(new THREE.BoxGeometry(.024,.02,2.5),stripMaterial); strip.position.set(x,.12,-.04); carGroup.add(strip); }
  const headSpots: THREE.SpotLight[]=[];
  const headBeams: THREE.Mesh<THREE.CylinderGeometry,THREE.ShaderMaterial>[]=[];
  const headHalos: THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>[]=[];
  const headOrigins=[new THREE.Vector3(),new THREE.Vector3()];
  const headDirections=[new THREE.Vector3(),new THREE.Vector3()];
  const headlightStrength={value:0};
  // Project the same light cones onto the ground, using the actual lamp origins.
  const headGroundMaterial=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{uLamp:headlightStrength,uOrigins:{value:headOrigins},uDirections:{value:headDirections}},
    vertexShader:
      'varying vec3 vWorldPosition;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorldPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}',
    fragmentShader:
      'varying vec3 vWorldPosition;uniform float uLamp;uniform vec3 uOrigins[2];uniform vec3 uDirections[2];void main(){float light=0.;for(int i=0;i<2;i++){vec3 ray=vWorldPosition-uOrigins[i];float d=max(length(ray),.001);float cone=smoothstep(cos(.20),cos(.12),dot(ray/d,uDirections[i]));light+=cone*(1.-smoothstep(4.,10.,d))*3./(1.+.6*d*d);}gl_FragColor=vec4(.66,.82,1.,min(light,.38)*uLamp);}'
  });
  const headGround=new THREE.Mesh(new THREE.PlaneGeometry(40,40),headGroundMaterial);
  headGround.name='Headlight ground projection';headGround.rotation.x=-Math.PI/2;headGround.position.set(0,.020,4);carGroup.add(headGround);

  function attachHeadlights(car:THREE.Object3D){
    const lampNode=car.getObjectByName('BodyHeadlights');
    if(!(lampNode instanceof THREE.Mesh))return;
    const positions=lampNode.geometry.getAttribute('position'),indices=lampNode.geometry.index;
    const bounds=[new THREE.Box3(),new THREE.Box3()];
    const lampSurfaces:THREE.Triangle[][]=[[],[]];
    for(let i=0;i<(indices?.count??positions.count);i+=3){
      const vertices=[0,1,2].map(offset=>{
        const point=new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+offset):i+offset);
        return carGroup.worldToLocal(point.applyMatrix4(lampNode.matrixWorld));
      });
      const triangle=new THREE.Triangle(vertices[0],vertices[1],vertices[2]);
      const side=triangle.getMidpoint(new THREE.Vector3()).x<0?0:1;
      if(triangle.getArea()<=1e-10)continue;
      lampSurfaces[side].push(triangle);vertices.forEach(vertex=>bounds[side].expandByPoint(vertex));
    }
    if(lampSurfaces.some(triangles=>triangles.length===0))return;
    bounds.forEach((box,i)=>{
      // The lamps slope back along the body: a bounding-box front plane floats
      // in front of the lens. Use its area-weighted centre, projected onto the lens.
      const centroid=new THREE.Vector3(),closest=new THREE.Vector3();let totalArea=0;
      for(const triangle of lampSurfaces[i]){
        const area=triangle.getArea();totalArea+=area;
        centroid.addScaledVector(triangle.getMidpoint(new THREE.Vector3()),area);
      }
      centroid.divideScalar(totalArea);
      // Bias slightly toward the lower-central lens area marked in the preview.
      centroid.y-=(box.max.y-box.min.y)*.12;
      const origin=headOrigins[i],lensNormal=new THREE.Vector3();let closestDistance=Infinity;
      for(const triangle of lampSurfaces[i]){
        triangle.closestPointToPoint(centroid,closest);
        const distance=closest.distanceToSquared(centroid);
        if(distance<closestDistance){closestDistance=distance;origin.copy(closest);triangle.getNormal(lensNormal);}
      }
      // Offset only along the actual lens surface, not the front plane of the body.
      if(lensNormal.z<0)lensNormal.negate();
      origin.addScaledVector(lensNormal,.003);
      const target=origin.clone().add(new THREE.Vector3(i===0?-.18:.18,0,5.8));target.y=.020;
      const direction=headDirections[i].copy(target).sub(origin).normalize();
      const spot=new THREE.SpotLight('#d7e9ff',0,12,.20,.4,2);
      spot.position.copy(origin);spot.target.position.copy(target);carGroup.add(spot,spot.target);headSpots.push(spot);

      const beamGeometry=new THREE.CylinderGeometry(1,.025,1,48,16,true);
      beamGeometry.translate(0,.5,0);beamGeometry.rotateX(Math.PI/2);
      // Nested soft volumes add visible depth without a hard outer surface.
      for(const [spread,density] of [[1,.62],[1.12,.30],[1.25,.16]]){
      const beamMaterial=new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        uniforms:{uLamp:headlightStrength,uDensity:{value:density}},
        vertexShader:
          'varying float vDistance;varying vec3 vNormal;varying vec3 vToEye;void main(){vDistance=position.z;mat3 orientation=mat3(normalize(modelViewMatrix[0].xyz),normalize(modelViewMatrix[1].xyz),normalize(modelViewMatrix[2].xyz));vNormal=normalize(orientation*normal);vec4 view=modelViewMatrix*vec4(position,1.);vToEye=-view.xyz;gl_Position=projectionMatrix*view;}',
        fragmentShader:
          'varying float vDistance;varying vec3 vNormal;varying vec3 vToEye;uniform float uLamp;uniform float uDensity;void main(){float side=pow(abs(dot(normalize(vNormal),normalize(vToEye))),2.);float fade=pow(max(0.,1.-vDistance),1.7)*smoothstep(0.,.001,vDistance);gl_FragColor=vec4(.65,.81,1.,uLamp*uDensity*.18*side*fade);}'
      });
      const beam=new THREE.Mesh(beamGeometry,beamMaterial);
      beam.name=i===0?'Right headlight beam':'Left headlight beam';
      beam.position.copy(origin);beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
      beam.scale.set(1.02*spread,.52*spread,origin.distanceTo(target));carGroup.add(beam);headBeams.push(beam);
      }
      // The glow is lens-aligned rather than a camera-facing sprite that clips into the bonnet.
      const halo=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:glowTexture,color:'#d7eaff',transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      halo.position.copy(origin);halo.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),lensNormal);
      halo.scale.set((box.max.x-box.min.x)*.75,.075,1);carGroup.add(halo);headHalos.push(halo);
    });
    container.dataset.headlightEmitters=String(headSpots.length);
    container.dataset.headlightBeamLayers=String(headBeams.length);
    container.dataset.headlightAnchorSource='BodyHeadlights';
    container.dataset.headlightOrigins=JSON.stringify(headOrigins.map(origin=>origin.toArray()));
    container.dataset.headlightAnchorMethod='area-centroid-on-lens-surface';
    container.dataset.headlightAttachmentError=Math.max(...headOrigins.map((origin,i)=>
      Math.min(...lampSurfaces[i].map(triangle=>triangle.closestPointToPoint(origin,new THREE.Vector3()).distanceTo(origin)))
    )).toFixed(4);
  }
  const underLight=new THREE.PointLight('#1379ff',0,4,2); underLight.position.set(0,.25,0); carGroup.add(underLight);

  // A straight driving section through the car, with tangent-matched bends only in the distance.
  const curve=new THREE.CurvePath<THREE.Vector3>();
  curve.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(-4.2,.028,-26),new THREE.Vector3(-2.7,.028,-13),
    new THREE.Vector3(0,.028,-8),new THREE.Vector3(0,.028,-4)
  ));
  curve.add(new THREE.LineCurve3(new THREE.Vector3(0,.028,-4),new THREE.Vector3(0,.028,9)));
  curve.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(0,.028,9),new THREE.Vector3(0,.028,15),
    new THREE.Vector3(.45,.028,20),new THREE.Vector3(2.1,.028,26)
  ));
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
  let storyTarget=0,story=0,viewTarget:View=options.view;
  const radar=new THREE.Group();radar.name='Corner radar pulses';carGroup.add(radar);
  const radarPulses:{mesh:THREE.Mesh;phase:number}[]=[];
  const radarMaterials:THREE.MeshBasicMaterial[]=[];
  for(const x of [-.88,.88])for(const z of [-1.8,1.8]){
    const node=new THREE.Mesh(new THREE.SphereGeometry(.028,12,12),new THREE.MeshBasicMaterial({color:'#2682ff',transparent:true,opacity:0,toneMapped:false}));
    node.position.set(x,.05,z);radar.add(node);radarMaterials.push(node.material);
    for(let i=0;i<4;i++){
      const mat=new THREE.MeshBasicMaterial({color:'#388fff',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
      const ring=new THREE.Mesh(new THREE.RingGeometry(.98,1,112),mat);
      ring.rotation.x=-Math.PI/2;ring.position.set(x,.025,z);radar.add(ring);radarPulses.push({mesh:ring,phase:i/4});
    }
  }
  const rearDetail=new THREE.Group();rearDetail.name='Layered rear light optics';carGroup.add(rearDetail);
  const rearGlowMaterials:THREE.MeshBasicMaterial[]=[];
  const tempCamera=new THREE.PerspectiveCamera();
  const upDefault=new THREE.Vector3(0,1,0),upOverhead=new THREE.Vector3(0,0,1);
  const qHome=new THREE.Quaternion(),qTop=new THREE.Quaternion(),qRear=new THREE.Quaternion(),qLogin=new THREE.Quaternion();
  function aimQuaternion(position:THREE.Vector3,target:THREE.Vector3,up:THREE.Vector3,output:THREE.Quaternion){tempCamera.position.copy(position);tempCamera.up.copy(up);tempCamera.lookAt(target);output.copy(tempCamera.quaternion);}
  const homePosition=new THREE.Vector3(),topPosition=new THREE.Vector3(),rearPosition=new THREE.Vector3(),loginPosition=new THREE.Vector3();
  const originLook=new THREE.Vector3(0,.42,0),topLook=new THREE.Vector3(0,0,0),rearLook=new THREE.Vector3(.48,.70,-2.20);
  const frontWheelLook=new THREE.Vector3(1,.42,1.4),rearWheelCenter=new THREE.Vector3(1,.42,-1.4);
  const projectedFocusWheel=new THREE.Vector3(),projectedOtherWheel=new THREE.Vector3();
  const composedPosition=new THREE.Vector3(),composedQuaternion=new THREE.Quaternion();

  const themes=new ThemeTransition(options.theme,reduced);
  let width=1,height=1,driveTime=0,prev=performance.now(), lastPhase='',lastLamp=-1;
  const colors=new THREE.Color();
  const resize=()=>{ const size=container.getBoundingClientRect(); width=Math.max(1,size.width);height=Math.max(1,size.height);renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix(); };
  const observer=new ResizeObserver(resize); observer.observe(container);resize();
  const onPointer=(e:PointerEvent)=>{if(reduced||story>.2||viewTarget==='login')return;const x=(e.clientX/window.innerWidth-.5),y=(e.clientY/window.innerHeight-.5);gsap.to(motion,{parallaxX:x*.7,parallaxY:y*.28,duration:1.2,overwrite:'auto',ease:'power2.out'});};
  window.addEventListener('pointermove',onPointer,{passive:true});
  const resetPointer=()=>gsap.to(motion,{parallaxX:0,parallaxY:0,duration:1.2,ease:'power2.out',overwrite:'auto'});
  document.documentElement.addEventListener('pointerleave',resetPointer);
  const onLost=(e:Event)=>{e.preventDefault(); if(!disposed)options.onError('3D 场景暂时不可用；仍可登录。请刷新重试。');};
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
      carGroup.updateMatrixWorld(true);
      // Anchor the close-up to the real left-front wheel; the same car remains in the scene.
      car.getObjectByName('WheelFrontL')?.getWorldPosition(frontWheelLook);
      car.getObjectByName('WheelRearL')?.getWorldPosition(rearWheelCenter);
      attachHeadlights(car);
      // Physical optics follow the existing lamp's actual bounds, not a replacement car.
      const lampNode=car.getObjectByName('BodyTaillights');
      if(lampNode){
        const lampBox=new THREE.Box3().setFromObject(lampNode);
        const lampCenter=lampBox.getCenter(new THREE.Vector3());
        rearLook.set(lampBox.max.x*.65,lampCenter.y,lampBox.min.z);
        const rearZ=lampBox.min.z-.014;
        for(const side of [-1,1]){
          const lampWidth=(lampBox.max.x-lampBox.min.x)*.37;
          const housing=new THREE.Mesh(new THREE.BoxGeometry(lampWidth,.14,.032),new THREE.MeshPhysicalMaterial({color:'#180b15',metalness:.48,roughness:.20,clearcoat:1,clearcoatRoughness:.09}));
          housing.position.set(side*(lampWidth*.56+.085),lampCenter.y,rearZ);rearDetail.add(housing);
          for(let row=0;row<2;row++){
            const glow=new THREE.MeshBasicMaterial({color:row?'#ff363d':'#ff4a52',toneMapped:false});rearGlowMaterials.push(glow);
            const strip=new THREE.Mesh(new THREE.BoxGeometry(lampWidth*.92,.012,.014),glow);
            strip.position.set(housing.position.x,lampCenter.y+(row?-.039:.038),rearZ-.025);rearDetail.add(strip);
          }
          for(let k=0;k<19;k++){
            const fin=new THREE.Mesh(new THREE.BoxGeometry(.008,.061,.013),new THREE.MeshStandardMaterial({color:'#9e151f',metalness:.55,roughness:.23,emissive:'#ef1830',emissiveIntensity:.36}));
            fin.position.set(housing.position.x-lampWidth*.44+k*lampWidth*.88/18,lampCenter.y,rearZ-.025);fin.rotation.z=-.25*side;rearDetail.add(fin);
          }
          const haloMat=new THREE.MeshBasicMaterial({color:'#ff203b',map:glowTexture,transparent:true,opacity:.16,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
          const halo=new THREE.Mesh(new THREE.PlaneGeometry(lampWidth*1.3,.34),haloMat);halo.rotation.y=Math.PI;halo.position.set(housing.position.x,lampCenter.y,rearZ-.04);rearDetail.add(halo);
        }
      }

      container.dataset.model=car.uuid;container.dataset.modelSource='CarConcept';container.dataset.loadCount='1';container.dataset.headlightMaterials=String(frontMaterials.length);
      await renderer.compileAsync(scene,camera);
      if(disposed)return;options.onProgress(100);modelPrepared=true;
    }catch(error){if(disposed || (error instanceof Error&&error.name==='AbortError'))return;console.error('Car scene failed',error);options.onError('模型加载失败，请刷新重试。登录不受影响。');}
  }
  void loadModel();

  const frame=(now:number)=>{
    if(disposed)return;
    const delta=Math.min((now-prev)/1000,.045);prev=now;
    if(document.hidden)return;
    if(!paused&&!reduced)driveTime+=delta;
    // All three views share the same drive clock; rotating around each wheel's
    // local axle preserves its hub position and pauses with reduced motion.
    for(const wheel of wheels){
      wheel.rotation.x=driveTime*3.2;
      // In the wheel close-up, the rim/disc rotate but the brake caliper stays fixed.
      if(frontWheelView)for(const part of wheel.children){
        if(part.name.endsWith('BrakePad'))part.rotation.x=-wheel.rotation.x;
      }
    }
    const theme=themes.sample(now);const night=theme.environment;
    colors.copy(lightBackground).lerp(darkBackground,night);(scene.background as THREE.Color).copy(colors);(scene.fog as THREE.Fog).color.copy(colors);groundMaterial.color.copy(colors);
    ambient.intensity=THREE.MathUtils.lerp(2.2,.62,night);key.intensity=THREE.MathUtils.lerp(3.2,1.55,night);rim.intensity=THREE.MathUtils.lerp(2,2.3,night);fill.intensity=THREE.MathUtils.lerp(1.4,.8,night);
    scene.environmentIntensity=THREE.MathUtils.lerp(1.0,.48,night);
    const lamp=theme.lamps;contactShadowMaterial.opacity=THREE.MathUtils.lerp(.3,.6,night);
    frontMaterials.forEach(m=>m.emissiveIntensity=.7+lamp*9);rearMaterials.forEach(m=>m.emissiveIntensity=.85+lamp*.7);
    headlightStrength.value=lamp;
    headSpots.forEach(s=>s.intensity=lamp*70);headHalos.forEach(s=>s.material.opacity=lamp*.6);
    headBeams.forEach(beam=>beam.visible=lamp>.001);headGround.visible=lamp>.001;
    underGlowMaterial.opacity=lamp*.58;stripMaterial.opacity=lamp;underLight.intensity=lamp*1.7;
    trackMaterial.uniforms.uTime.value=driveTime;trackMaterial.uniforms.uDark.value=night;
    if(viewTarget==='home')story=reduced?storyTarget:THREE.MathUtils.damp(story,storyTarget,6,delta);
    const v=motion.view,mobile=width<760;
    const firstMix=THREE.MathUtils.smoothstep(story,.08,.94);
    const secondMix=THREE.MathUtils.smoothstep(story,1.06,1.96);
    const overview=(1-secondMix)*firstMix*(1-v);
    const macro=secondMix*(1-v);
    const parallax=(1-firstMix)*(1-v);
    carGroup.position.y=0;carGroup.rotation.z=0;
    const zoom=mobile?1.7:(width/height<1.4?1.13:1);
    homePosition.set(6.4,7.3,8.4).multiplyScalar(zoom);
    homePosition.x+=motion.parallaxX*parallax;homePosition.y+=motion.parallaxY*parallax;
    // Raise the overhead camera to make the vehicle approximately 20% smaller.
    topPosition.set(0,(mobile?18.4:13.6)/.8,.001);
    // The trial focuses on the left-front wheel; the original taillight view remains available.
    if(frontWheelView){
      // Approach from the left and slightly ahead to include the front fender and nose.
      rearPosition.set(frontWheelLook.x+(mobile?5.0:3.6),frontWheelLook.y+.38,frontWheelLook.z+1.0);
    }else{
      rearPosition.set(rearLook.x+.30,rearLook.y+.30,rearLook.z-(mobile?3.3:2.65));
    }
    loginPosition.set(6.9,3.9,8.7).multiplyScalar(zoom);
    aimQuaternion(homePosition,originLook,upDefault,qHome);
    aimQuaternion(topPosition,topLook,upOverhead,qTop);
    aimQuaternion(rearPosition,frontWheelView?frontWheelLook:rearLook,upDefault,qRear);
    aimQuaternion(loginPosition,originLook,upDefault,qLogin);
    if(story<=1){composedPosition.copy(homePosition).lerp(topPosition,firstMix);composedQuaternion.copy(qHome).slerp(qTop,firstMix);}
    else{composedPosition.copy(topPosition).lerp(rearPosition,secondMix);composedQuaternion.copy(qTop).slerp(qRear,secondMix);}
    camera.position.copy(composedPosition.lerp(loginPosition,v));
    camera.quaternion.copy(composedQuaternion.slerp(qLogin,v));
    camera.fov=32;camera.updateProjectionMatrix();
    const homeOffset=mobile?0:-.43;
    const topOffset=mobile?0:.43;
    // Keep the wheel framing clear of copy; preserve the previous rear offsets
    // exactly for the comparison view without moving or scaling the model.
    const rearOffset=frontWheelView?(mobile?0:-.48):(mobile?-.15:-.63)+.2;
    const storyOffset=story<=1?THREE.MathUtils.lerp(homeOffset,topOffset,firstMix):THREE.MathUtils.lerp(topOffset,rearOffset,secondMix);
    camera.projectionMatrix.elements[8]=THREE.MathUtils.lerp(storyOffset,mobile?0:.4,v);
    const homeY=mobile?.25:-.015,topY=mobile?.33:-.015,rearY=frontWheelView?(mobile?.54:.28):(mobile?.25:-.015)+.4;
    const storyY=story<=1?THREE.MathUtils.lerp(homeY,topY,firstMix):THREE.MathUtils.lerp(topY,rearY,secondMix);
    camera.projectionMatrix.elements[9]=THREE.MathUtils.lerp(storyY,mobile?-.65:-.015,v);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld();
    projectedFocusWheel.copy(frontWheelLook).project(camera);
    projectedOtherWheel.copy(rearWheelCenter).project(camera);
    container.dataset.thirdView=frontWheelView?'front-left-wheel':'taillight';
    container.dataset.frontWheelScreenX=((projectedFocusWheel.x+1)/2).toFixed(3);
    container.dataset.frontWheelScreenY=((1-projectedFocusWheel.y)/2).toFixed(3);
    container.dataset.rearWheelScreenX=((projectedOtherWheel.x+1)/2).toFixed(3);
    radar.visible=overview>.002;
    radarMaterials.forEach(m=>m.opacity=overview*.9);
    for(const pulse of radarPulses){
      const p=(driveTime*.30+pulse.phase)%1;
      const radius=.10+p*1.2;
      pulse.mesh.scale.setScalar(radius);
      (pulse.mesh.material as THREE.MeshBasicMaterial).opacity=overview*Math.sin(p*Math.PI)*.4;
    }
    // The road belongs to the driving scene, not just the hero camera.
    trackMaterial.visible=true;trackGlowMaterial.visible=true;
    rearDetail.visible=true;
    rearGlowMaterials.forEach(m=>m.color.setRGB(1,.04+macro*.035,.06+macro*.035));
    container.dataset.wheelCount=String(wheels.length);container.dataset.wheelAngle=(wheels[0]?.rotation.x??0).toFixed(3);container.dataset.roadTime=driveTime.toFixed(3);container.dataset.roadVisible=String(trackMaterial.visible);
    container.dataset.storyProgress=story.toFixed(3);container.dataset.radarOpacity=overview.toFixed(3);container.dataset.macro=macro.toFixed(3);
    container.dataset.lightPhase=theme.phase;container.dataset.lamps=lamp.toFixed(3);container.dataset.environment=night.toFixed(3);container.dataset.cameraView=v.toFixed(3);container.dataset.parallaxX=motion.parallaxX.toFixed(3);container.dataset.parallaxY=motion.parallaxY.toFixed(3);
    if(lastPhase!==theme.phase||Math.abs(lastLamp-lamp)>.24){lastPhase=theme.phase;lastLamp=lamp;options.onPhase(theme.phase,lamp);}
    renderer.render(scene,camera);
    if(modelPrepared&&!readyNotified){readyNotified=true;options.onReady();}
  };
  renderer.setAnimationLoop(frame);
  return {
    setTheme(theme){themes.setTarget(theme,performance.now());},
    setStoryProgress(value){storyTarget=THREE.MathUtils.clamp(value,0,2);},
    setView(view){viewTarget=view;gsap.to(motion,{view:view==='login'?1:0,duration:reduced?.12:1.65,ease:'power3.inOut',overwrite:'auto',onComplete:()=>{if(!disposed)options.onViewSettled(view);}});},
    setPaused(value){paused=value;},
    setReducedMotion(value){reduced=value;themes.setReducedMotion(value);if(value){gsap.set(motion,{parallaxX:0,parallaxY:0});}},
    dispose(){if(disposed)return;disposed=true;abort.abort();gsap.killTweensOf(motion);observer.disconnect();window.removeEventListener('pointermove',onPointer);document.documentElement.removeEventListener('pointerleave',resetPointer);renderer.domElement.removeEventListener('webglcontextlost',onLost);renderer.setAnimationLoop(null);disposeTree(scene);environmentTarget.dispose();glowTexture.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}

function disposeTree(root:THREE.Object3D){
  const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),geometries=new Set<THREE.BufferGeometry>();
  root.traverse(object=>{if(object instanceof THREE.Sprite){materials.add(object.material);return;}if(!(object instanceof THREE.Mesh))return;geometries.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
  materials.forEach(material=>{Object.values(material).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});material.dispose();});
  geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());
}

