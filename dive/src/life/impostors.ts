import * as THREE from 'three';
import { underwaterMaterial } from '../render/underwater';
import { IMPOSTOR } from '../game/render';

/**
 * L2 of the creature LOD (PHASE8-DESIGN §1.1-1.3): far individuals of every species are drawn as cards from one
 * shared atlas, in a single InstancedMesh (one draw call for all species).
 *
 * - The atlas (2048×1024, cells of 128×64 → 256 cells) holds one side view per species (rays: the top view).
 *   A cell is drawn on the GPU from the species' own L0 geometry and texture (neutral pose, unlit albedo), first
 *   into a small scratch target at twice the cell size, then box-filtered into the cell. The background stays
 *   (0,0,0,0), so the filtered and mip-mapped texels are premultiplied; the card shader divides by alpha.
 * - A card turns about the body's length axis toward the camera (axis-fixed billboard), so seen head-on it is thin
 *   like a real fish. Ray cards lie flat in the body plane. The card is cut in 3 along its length and bent with the
 *   same travelling wave as the body (phase, amplitude and turn per individual).
 */
export type ImpostorCell = {
  index: number;
  /** card rectangle in body units: z from tail to head, and y (side view) or x (top view) */
  z0: number; z1: number; y0: number; y1: number;
  /** top view lying in the body plane (rays) instead of a side view turned toward the camera */
  flat: boolean;
  ready: boolean;
  /** what the cell is drawn from (dropped once drawn) */
  geo?: THREE.BufferGeometry;
  map?: THREE.Texture;
  alphaTest?: boolean;
};

const CARD_VARY = /* glsl */ `varying vec3 vImpCol; varying float vImpFlat; varying vec3 vImpC; varying vec3 vImpU; varying float vImpR;`;
const CARD_VERT_HEAD = /* glsl */ `attribute vec4 aImpA; attribute vec4 aImpB; attribute vec4 aImpS; ${CARD_VARY}`;
const CARD_VERT_BODY = /* glsl */ `
  {
    // aImpA = (cell, flat, z0, z1), aImpB = (y0, y1, packed linear colour, -), aImpS = (phase, amplitude, C-bend, wave number)
    float zc = mix( aImpA.z, aImpA.w, position.x );
    float yc = mix( aImpB.x, aImpB.y, position.y );
    vec3 nb = vec3( 0.0, 1.0, 0.0 );
    vImpFlat = aImpA.y;
    vImpC = vec3( 0.0, 0.0, 1.0 );
    vImpU = vec3( 0.0, 1.0, 0.0 );
    vImpR = 0.0;
    vec3 toCam = vec3( 1.0, 0.0, 0.0 );
    #ifdef USE_INSTANCING
      toCam = transpose( mat3( instanceMatrix ) ) * ( cameraPosition - ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz );
    #endif
    if ( aImpA.y < 0.5 ) {
      vec2 v = toCam.xy;
      float lv = length( v );
      vec2 n2 = lv > 1e-5 ? v / lv : vec2( 1.0, 0.0 );
      vec2 u2 = vec2( -n2.y, n2.x );
      if ( u2.y < 0.0 ) u2 = -u2; // keep the back up
      // the body wave along the card: s = 0 at the head .. 1 at the tail
      float sb = 1.0 - position.x;
      float cb = sb - 0.35;
      float o = aImpS.y * sb * sb * sin( aImpS.x - aImpS.w * sb ) + aImpS.z * cb * cb;
      transformed = vec3( u2 * yc, zc );
      transformed.x += o;
      // shaded like the body it stands for (in the fragment shader): a laterally flattened body shows mostly its flank,
      // whose normal turns up toward the back and down toward the belly only near the outline
      vec2 ce = normalize( vec2( n2.x * 4.0, n2.y ) );
      nb = vec3( ce, 0.0 );
      vImpR = position.y * 2.0 - 1.0;
      #ifdef USE_INSTANCING
        vImpC = normalize( normalMatrix * ( mat3( instanceMatrix ) * vec3( ce, 0.0 ) ) );
        vImpU = normalize( normalMatrix * ( mat3( instanceMatrix ) * vec3( u2, 0.0 ) ) );
      #endif
    } else {
      // flat animals lie in the body plane, tipped toward the camera so that edge-on they do not vanish
      // (S8/BI: the tip was 0.26 rad, which left a ~6px sliver at L2 sizes; 0.5 rad keeps the span readable)
      float tilt = clamp( atan( toCam.x, max( abs( toCam.y ), 1e-4 ) ) * sign( toCam.y + 1e-6 ), -0.5, 0.5 );
      float ct = cos( tilt ), st = sin( tilt );
      transformed = vec3( yc * ct, -yc * st, zc );
      nb = vec3( st, ct, 0.0 );
    }
    objectNormal = nb;
    transformedNormal = objectNormal;
    #ifdef USE_INSTANCING
      transformedNormal = mat3( instanceMatrix ) * transformedNormal;
    #endif
    transformedNormal = normalMatrix * transformedNormal;
    #ifndef FLAT_SHADED
      vNormal = normalize( transformedNormal );
    #endif
    #ifdef USE_MAP
      vMapUv = vec2( ( mod( aImpA.x, ${IMPOSTOR.cols}.0 ) + position.x ) / ${IMPOSTOR.cols}.0, ( floor( aImpA.x / ${IMPOSTOR.cols}.0 ) + position.y ) / ${IMPOSTOR.rows}.0 );
    #endif
    float pc = aImpB.z;
    vImpCol = vec3( floor( pc / 65536.0 ), mod( floor( pc / 256.0 ), 256.0 ), mod( pc, 256.0 ) ) / 255.0;
  }`;

/** Pack a linear colour (0..1 per channel) into one float that a 32-bit float keeps exactly (24 bits). */
export function packColor(c: THREE.Color | undefined): number {
  if (!c) return 16777215;
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return q(c.r) * 65536 + q(c.g) * 256 + q(c.b);
}

function cardGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const cols = 3;
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= 1; j++) { pos.push(i / cols, j, 0); uv.push(i / cols, j); nrm.push(1, 0, 0); }
  for (let i = 0; i < cols; i++) { const a = i * 2, b = a + 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // the cards are placed by the vertex shader: never culled by the (meaningless) unit bounds
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export class Impostors {
  /** the one draw call of every L2 individual (rebuilt when it outgrows its capacity) */
  mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly atlas: THREE.WebGLRenderTarget;
  private readonly scratch: THREE.WebGLRenderTarget;
  private cap = 0;
  private aA!: THREE.InstancedBufferAttribute;
  private aB!: THREE.InstancedBufferAttribute;
  private aS!: THREE.InstancedBufferAttribute;
  /** individuals written this frame */
  count = 0;
  private readonly free: number[] = [];
  private readonly pending: ImpostorCell[] = [];
  // drawing a cell
  private readonly cellScene = new THREE.Scene();
  private readonly cellMesh: THREE.Mesh;
  private readonly cellMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private readonly cellMatA = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  private readonly cellCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
  private readonly copyScene = new THREE.Scene();
  private readonly copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly tmpCol = new THREE.Color();

  constructor(private parent: THREE.Object3D) {
    const { atlasW, atlasH, cols, rows, supersample } = IMPOSTOR;
    this.atlas = new THREE.WebGLRenderTarget(atlasW, atlasH, {
      colorSpace: THREE.SRGBColorSpace, depthBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.scratch = new THREE.WebGLRenderTarget((atlasW / cols) * supersample, (atlasH / rows) * supersample, {
      colorSpace: THREE.SRGBColorSpace, depthBuffer: true, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    for (let i = cols * rows - 1; i >= 0; i--) this.free.push(i);
    this.cellMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.cellMat);
    this.cellMesh.frustumCulled = false;
    this.cellScene.add(this.cellMesh);
    const copy = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tMap: { value: this.scratch.texture } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
        // the target texel sits on the corner of 2×2 scratch texels: one bilinear tap is their box filter
        fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = texture2D( tMap, vUv ); }',
        depthTest: false, depthWrite: false,
      }),
    );
    copy.frustumCulled = false;
    this.copyScene.add(copy);

    // wet skin like the L0 / L1 materials (roughness 0.38), and their back-scatter rim
    const mat = new THREE.MeshStandardMaterial({ map: this.atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.38, metalness: 0, envMapIntensity: 0.9 });
    this.material = underwaterMaterial(mat, {
      key: 'cr-imp',
      caustic: 0.9,
      noCaustic: true,
      vertexHead: CARD_VERT_HEAD,
      vertexBody: CARD_VERT_BODY,
      fragHead: CARD_VARY,
      // the atlas is premultiplied (transparent black around the animal): undo it, then the per-individual colour
      // (× CARD_GAIN: a flat card lacks the curved body's sky reflections and lit fin margins, measured against L1)
      fragDiffuse: `diffuseColor.rgb = diffuseColor.rgb / max( diffuseColor.a, 0.004 ) * vImpCol * ${IMPOSTOR.gain.toFixed(2)};`,
      // a side card always faces the camera: keep its normal (no back-face flip)
      fragBeforeLights: `if ( vImpFlat < 0.5 ) {
        float q = vImpR * abs( vImpR );
        normal = normalize( normalize( vImpC ) * sqrt( max( 1.0 - q * q, 0.0 ) ) + normalize( vImpU ) * q );
      }`,
      // the L0 / L1 back-scatter rim lights the silhouette: here the outline is where the blurred (coarser mip) alpha drops
      fragEmissive: `{
        float edge = 1.0 - smoothstep( 0.8, 1.0, texture2D( map, vMapUv, 1.0 ).a );
        totalEmissiveRadiance += uSunCol * edge * 0.1 * exp( min( vUwPos.y, 0.0 ) / 30.0 );
      }`,
    });
    this.mesh = this.makeMesh(IMPOSTOR.capacity);
  }

  private makeMesh(cap: number): THREE.InstancedMesh {
    this.cap = cap;
    const g = cardGeometry();
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aImpA', this.aA);
    g.setAttribute('aImpB', this.aB);
    g.setAttribute('aImpS', this.aS);
    const m = new THREE.InstancedMesh(g, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = 'impostors';
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  /** a stand-in with the card material, for the shader warm-up before a dive */
  warmupObject(): THREE.Object3D {
    const m = new THREE.InstancedMesh(cardGeometry(), this.material, 1);
    m.frustumCulled = false;
    return m;
  }

  /** Reserve a cell for a species; it is drawn by a later `flush`. null when the atlas is full. */
  alloc(geo: THREE.BufferGeometry, map: THREE.Texture, o: { flat: boolean; alphaTest: boolean }): ImpostorCell | null {
    const index = this.free.pop();
    if (index === undefined) return null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const m = IMPOSTOR.margin;
    const zl = b.max.z - b.min.z, yl = o.flat ? b.max.x - b.min.x : b.max.y - b.min.y;
    const yc0 = o.flat ? b.min.x : b.min.y;
    const cell: ImpostorCell = {
      index, flat: o.flat, ready: false, geo, map, alphaTest: o.alphaTest,
      z0: b.min.z - zl * m, z1: b.max.z + zl * m, y0: yc0 - yl * m - zl * 0.01, y1: yc0 + yl * (1 + m) + zl * 0.01,
    };
    this.pending.push(cell);
    return cell;
  }

  release(cell: ImpostorCell | undefined): void {
    if (!cell) return;
    const k = this.pending.indexOf(cell);
    if (k >= 0) this.pending.splice(k, 1);
    cell.geo = undefined;
    cell.map = undefined;
    cell.ready = false;
    if (!this.free.includes(cell.index)) this.free.push(cell.index);
  }

  /** Draw up to `max` waiting cells whose texture has arrived (photo textures load asynchronously). */
  flush(renderer: THREE.WebGLRenderer, max = IMPOSTOR.perFrame): number {
    let n = 0;
    for (let k = 0; k < this.pending.length && n < max; ) {
      const c = this.pending[k];
      const img = c.map?.image as { width?: number } | undefined;
      if (!img || !img.width) { k++; continue; }
      this.pending.splice(k, 1);
      this.drawCell(renderer, c);
      n++;
    }
    return n;
  }

  /** cells still waiting to be drawn */
  get waiting(): number {
    return this.pending.length;
  }

  private drawCell(renderer: THREE.WebGLRenderer, c: ImpostorCell): void {
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(this.tmpCol);
    const prevAlpha = renderer.getClearAlpha();
    const cam = this.cellCam;
    if (c.flat) { cam.position.set(0, 10, 0); cam.up.set(1, 0, 0); }
    else { cam.position.set(-10, 0, 0); cam.up.set(0, 1, 0); }
    cam.lookAt(0, 0, 0);
    // camera right = +z (head), up = +y (side) or +x (top)
    cam.left = c.z0; cam.right = c.z1; cam.bottom = c.y0; cam.top = c.y1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const mat = c.alphaTest ? this.cellMatA : this.cellMat;
    mat.map = c.map ?? null;
    this.cellMesh.material = mat;
    this.cellMesh.geometry = c.geo!;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.scratch);
    renderer.clear(true, true, false);
    renderer.render(this.cellScene, cam);
    const { cols, rows } = IMPOSTOR;
    const w = this.atlas.width / cols, h = this.atlas.height / rows;
    const x = (c.index % cols) * w, y = Math.floor(c.index / cols) * h;
    this.atlas.viewport.set(x, y, w, h);
    this.atlas.scissor.set(x, y, w, h);
    this.atlas.scissorTest = true;
    renderer.setRenderTarget(this.atlas);
    renderer.render(this.copyScene, this.copyCam);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(this.tmpCol, prevAlpha);
    renderer.autoClear = prevAuto;
    this.cellMesh.geometry = this.emptyGeo;
    mat.map = null;
    c.geo = undefined;
    c.map = undefined;
    c.ready = true;
  }
  private readonly emptyGeo = new THREE.BufferGeometry();

  /** Compile the cell-drawing shaders (they render into a target, so the screen warm-up does not cover them). */
  warm(renderer: THREE.WebGLRenderer): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const last = IMPOSTOR.cols * IMPOSTOR.rows - 1;
    for (const alphaTest of [false, true]) {
      const c: ImpostorCell = { index: last, flat: false, ready: false, geo: g, map: tex, alphaTest, z0: -0.5, z1: 0.5, y0: -0.5, y1: 0.5 };
      this.drawCell(renderer, c);
    }
    // the stand-in left nothing in that cell (degenerate triangle); it is overwritten when the cell is used
    g.dispose();
    tex.dispose();
  }

  begin(): void {
    this.count = 0;
  }

  /** Add one individual: transform, cell, swim (phase, amplitude, C-bend, wave number) and packed colour. */
  add(m: THREE.Matrix4, c: ImpostorCell, ph: number, amp: number, bend: number, k: number, color: number): void {
    if (this.count >= this.cap) this.grow();
    const i = this.count++;
    this.mesh.setMatrixAt(i, m);
    const a = this.aA.array as Float32Array, b = this.aB.array as Float32Array, s = this.aS.array as Float32Array;
    const o = i * 4;
    a[o] = c.index; a[o + 1] = c.flat ? 1 : 0; a[o + 2] = c.z0; a[o + 3] = c.z1;
    b[o] = c.y0; b[o + 1] = c.y1; b[o + 2] = color; b[o + 3] = 0;
    s[o] = ph; s[o + 1] = amp; s[o + 2] = bend; s[o + 3] = k;
  }

  private grow(): void {
    const old = this.mesh;
    const n = this.count;
    const oa = this.aA.array as Float32Array, ob = this.aB.array as Float32Array, os = this.aS.array as Float32Array;
    const om = old.instanceMatrix.array as Float32Array;
    this.parent.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.mesh = this.makeMesh(this.cap * 2);
    (this.aA.array as Float32Array).set(oa.subarray(0, n * 4));
    (this.aB.array as Float32Array).set(ob.subarray(0, n * 4));
    (this.aS.array as Float32Array).set(os.subarray(0, n * 4));
    (this.mesh.instanceMatrix.array as Float32Array).set(om.subarray(0, n * 16));
  }

  end(): void {
    const n = this.count;
    const m = this.mesh;
    m.count = n;
    m.visible = n > 0;
    if (!n) return;
    for (const [attr, size] of [[m.instanceMatrix, 16], [this.aA, 4], [this.aB, 4], [this.aS, 4]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * size);
      attr.needsUpdate = true;
    }
  }
}
