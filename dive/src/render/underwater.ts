import * as THREE from 'three';

/** Shared uniforms referenced by every injected shader (update once per frame). */
export const UW = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 1, 0.42).normalize() },
  uCaustic: { value: 1 }, // global caustic strength (fades with camera depth)
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uCamY: { value: 0 },
};

let fogPatched = false;
/**
 * Replace three's fog chunks with a direction-aware underwater fog: looking up is brighter
 * (toward the surface), looking down falls off toward darkness. FogExp2.color is the horizontal
 * water color at the camera depth; density drives visibility.
 */
export function patchFogChunks(): void {
  if (fogPatched) return;
  fogPatched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 uwWaterColor( vec3 dir ) {
    float shallow = exp( min( cameraPosition.y, 0.0 ) / 32.0 );
    float up = max( dir.y, 0.0 );
    float dn = max( -dir.y, 0.0 );
    vec3 c = fogColor * ( 1.0 + up * up * ( 0.9 + 2.2 * shallow ) );
    c *= 1.0 - dn * 0.62;
    return c;
  }
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  vec3 uwDir = normalize( vFogWorld - cameraPosition );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // water absorbs red first: tint the in-scattered path color
  gl_FragColor.rgb = mix( gl_FragColor.rgb * mix( vec3( 1.0 ), vec3( 0.55, 0.85, 1.0 ), fogFactor * 0.8 ), uwWaterColor( uwDir ), fogFactor );
#endif`;
}

const CAUSTIC_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uCaustic;
uniform vec3 uSunCol;
uniform float uCamY;
varying vec3 vUwPos;
varying vec3 vUwNrm;
// Tileable water caustic (iterative trig warp, after Dave Hoskins' public shadertoy).
float uwCaustic( vec2 uv, float t ) {
  vec2 p = mod( uv, 6.2831853 ) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for ( int n = 0; n < 4; n++ ) {
    float tt = t * ( 1.0 - ( 3.5 / float( n + 1 ) ) );
    i = p + vec2( cos( tt - i.x ) + sin( tt + i.y ), sin( tt - i.y ) + cos( tt + i.x ) );
    c += 1.0 / length( vec2( p.x / ( sin( i.x + tt ) / inten ), p.y / ( cos( i.y + tt ) / inten ) ) );
  }
  c /= 4.0;
  c = 1.17 - pow( c, 1.4 );
  return clamp( pow( abs( c ), 8.0 ), 0.0, 1.6 );
}
`;

const UW_BUMP = /* glsl */ `
vec3 uwBump( vec3 n, float h ) {
  vec3 dpx = dFdx( -vViewPosition ), dpy = dFdy( -vViewPosition );
  float dhx = dFdx( h ), dhy = dFdy( h );
  vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );
  float det = dot( dpx, r1 );
  vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );
  vec3 r = abs( det ) * n - grad;
  return dot( r, r ) > 1e-12 ? normalize( r ) : n;
}
float uwHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
float uwNoise( vec3 p ) {
  vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( uwHash( i ), uwHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( uwHash( i + vec3( 0, 1, 0 ) ), uwHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( uwHash( i + vec3( 0, 0, 1 ) ), uwHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( uwHash( i + vec3( 0, 1, 1 ) ), uwHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

type InjectOpts = {
  key: string;
  caustic?: number; // per-material strength multiplier
  vertexHead?: string;
  vertexBody?: string; // runs after <begin_vertex>, can modify 'transformed'
  fragHead?: string;
  fragFuncs?: string; // inserted right before main(), after all declarations
  fragBeforeLights?: string; // runs after <normal_fragment_maps>
  fragDiffuse?: string; // runs after <color_fragment>, may modify diffuseColor
  fragEmissive?: string; // runs after <emissivemap_fragment>, may add to totalEmissiveRadiance
  uniforms?: Record<string, { value: unknown }>;
  /** Triplanar baked detail (RGB normal + A albedo) in world space. */
  tri?: { tex: THREE.Texture; scale: number; strength: number; albedo: number; tex2?: THREE.Texture; scale2?: number; mix2?: string };
  /** Triplanar photo-sourced PBR pair (albedo mean 0.5, OpenGL normal). Two scales hide tiling. */
  pbr?: { a: THREE.Texture; n: THREE.Texture; scale: number; k: number; albedo: number };
};

/** Triplanar / top-projected PBR helpers (albedo + OpenGL normal map pairs). */
export const PBR_FUNCS = /* glsl */ `
vec3 pbrW( vec3 N ) { vec3 w = pow( abs( N ), vec3( 4.0 ) ); return w / dot( w, vec3( 1.0 ) ); }
vec3 pbrTriA( sampler2D A, vec3 P, vec3 w, float s ) {
  return texture2D( A, P.zy * s ).rgb * w.x + texture2D( A, P.xz * s ).rgb * w.y + texture2D( A, P.xy * s ).rgb * w.z;
}
vec3 pbrTriN( sampler2D T, vec3 P, vec3 N, vec3 w, float s, float k ) {
  vec3 nx = texture2D( T, P.zy * s ).xyz * 2.0 - 1.0, ny = texture2D( T, P.xz * s ).xyz * 2.0 - 1.0, nz = texture2D( T, P.xy * s ).xyz * 2.0 - 1.0;
  nx.xy *= k; ny.xy *= k; nz.xy *= k;
  nx = vec3( nx.xy + N.zy, abs( nx.z ) * N.x );
  ny = vec3( ny.xy + N.xz, abs( ny.z ) * N.y );
  nz = vec3( nz.xy + N.xy, abs( nz.z ) * N.z );
  return normalize( nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z );
}
vec3 pbrTopN( sampler2D T, vec2 uv, vec3 N, float k ) {
  vec3 t = texture2D( T, uv ).xyz * 2.0 - 1.0; t.xy *= k;
  return normalize( vec3( t.x + N.x, abs( t.z ) * N.y, -t.y + N.z ) );
}
`;

const TRI_FUNCS = /* glsl */ `
vec4 uwTri( sampler2D T, vec3 P, vec3 N, float s, float k, out vec3 nW ) {
  vec3 w = pow( abs( N ), vec3( 4.0 ) ); w /= dot( w, vec3( 1.0 ) );
  vec4 tx = texture2D( T, P.zy * s ), ty = texture2D( T, P.xz * s ), tz = texture2D( T, P.xy * s );
  vec3 nx = tx.xyz * 2.0 - 1.0, ny = ty.xyz * 2.0 - 1.0, nz = tz.xyz * 2.0 - 1.0;
  nx.xy *= k; ny.xy *= k; nz.xy *= k;
  nx = vec3( nx.xy + N.zy, abs( nx.z ) * N.x );
  ny = vec3( ny.xy + N.xz, abs( ny.z ) * N.y );
  nz = vec3( nz.xy + N.xy, abs( nz.z ) * N.z );
  nW = normalize( nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z );
  return tx * w.x + ty * w.y + tz * w.z;
}
`;

/**
 * Inject underwater lighting into a stock MeshStandardMaterial: projected caustics on up-facing
 * surfaces and depth-relative light falloff. Optional extra vertex/fragment hooks share the
 * same compile so materials keep one program each.
 */
export function underwaterMaterial<T extends THREE.MeshStandardMaterial>(mat: T, o: InjectOpts): T {
  const strength = o.caustic ?? 1;
  if (o.pbr) {
    const t = o.pbr;
    o = { ...o };
    o.uniforms = { ...(o.uniforms ?? {}), uPbrA: { value: t.a }, uPbrN: { value: t.n }, uPbrS: { value: t.scale }, uPbrK: { value: t.k }, uPbrAl: { value: t.albedo } };
    o.fragHead = `${o.fragHead ?? ''}\nuniform sampler2D uPbrA; uniform sampler2D uPbrN; uniform float uPbrS; uniform float uPbrK; uniform float uPbrAl;`;
    o.fragFuncs = PBR_FUNCS + (o.fragFuncs ?? '');
    o.fragDiffuse = `vec3 pbN0 = normalize( vUwNrm ) * ( gl_FrontFacing ? 1.0 : -1.0 );
      vec3 pbw = pbrW( pbN0 );
      float pbm = smoothstep( 0.25, 0.75, uwNoise( vUwPos * 0.35 ) );
      vec3 pbA = mix( pbrTriA( uPbrA, vUwPos, pbw, uPbrS ), pbrTriA( uPbrA, vUwPos.zxy + 7.3, pbw.zxy, uPbrS * 0.43 ), pbm );
      vec3 pbNW = pbrTriN( uPbrN, vUwPos, pbN0, pbw, uPbrS, uPbrK );
      diffuseColor.rgb *= mix( vec3( 1.0 ), pbA * 2.0, uPbrAl );
      ${o.fragDiffuse ?? ''}`;
    o.fragBeforeLights = `normal = normalize( mat3( viewMatrix ) * pbNW );\n${o.fragBeforeLights ?? ''}`;
  }
  if (o.tri) {
    const t = o.tri;
    o = { ...o };
    o.uniforms = { ...(o.uniforms ?? {}), uTriTex: { value: t.tex }, uTriS: { value: t.scale }, uTriK: { value: t.strength }, uTriA: { value: t.albedo } };
    if (t.tex2) Object.assign(o.uniforms, { uTriTex2: { value: t.tex2 }, uTriS2: { value: t.scale2 ?? t.scale } });
    o.fragHead = `${o.fragHead ?? ''}\nuniform sampler2D uTriTex; uniform float uTriS; uniform float uTriK; uniform float uTriA;${t.tex2 ? ' uniform sampler2D uTriTex2; uniform float uTriS2;' : ''}`;
    o.fragFuncs = TRI_FUNCS + (o.fragFuncs ?? '');
    const mix2 = t.tex2 ? `{ vec3 n2; vec4 d2 = uwTri( uTriTex2, vUwPos, uwN0, uTriS2, uTriK, n2 ); float m2 = ${t.mix2 ?? '0.0'}; triD = mix( triD, d2, m2 ); triN = normalize( mix( triN, n2, m2 ) ); }` : '';
    o.fragDiffuse = `vec3 uwN0 = normalize( vUwNrm ) * ( gl_FrontFacing ? 1.0 : -1.0 );
      vec3 triN; vec4 triD = uwTri( uTriTex, vUwPos, uwN0, uTriS, uTriK, triN );
      ${mix2}
      diffuseColor.rgb *= mix( 1.0, triD.a * 1.45, uTriA );
      ${o.fragDiffuse ?? ''}`;
    o.fragBeforeLights = `normal = normalize( mat3( viewMatrix ) * triN );\n${o.fragBeforeLights ?? ''}`;
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = UW.uTime;
    shader.uniforms.uSunDir = UW.uSunDir;
    shader.uniforms.uCaustic = UW.uCaustic;
    shader.uniforms.uSunCol = UW.uSunCol;
    shader.uniforms.uCamY = UW.uCamY;
    shader.uniforms.uMatCaustic = { value: strength };
    if (o.uniforms) Object.assign(shader.uniforms, o.uniforms);
    mat.userData.shader = shader;
    shader.vertexShader =
      `uniform float uTime;\nvarying vec3 vUwPos;\nvarying vec3 vUwNrm;\n${o.vertexHead ?? ''}\n` +
      shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vertexBody ?? ''}`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
  {
    vec4 uwW = vec4( transformed, 1.0 );
    vec3 uwN = objectNormal;
    #ifdef USE_INSTANCING
      uwW = instanceMatrix * uwW;
      uwN = mat3( instanceMatrix ) * uwN;
    #endif
    uwW = modelMatrix * uwW;
    vUwPos = uwW.xyz;
    vUwNrm = normalize( mat3( modelMatrix ) * uwN );
  }`,
        );
    shader.fragmentShader =
      `${CAUSTIC_GLSL}\nuniform float uMatCaustic;\n${o.fragHead ?? ''}\n` +
      shader.fragmentShader
        .replace('void main() {', `${UW_BUMP}\n${o.fragFuncs ?? ''}\nvoid main() {`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.fragEmissive ?? ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${o.fragDiffuse ?? ''}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.fragBeforeLights ?? ''}`)
        .replace(
          '#include <opaque_fragment>',
          `{
    float upF = clamp( normalize( vUwNrm ).y * 0.8 + 0.25, 0.0, 1.0 );
    float depthF = exp( min( vUwPos.y, 0.0 ) / 13.0 );
    vec2 cp = ( vUwPos.xz - vUwPos.y * uSunDir.xz / uSunDir.y ) * 0.32;
    float ca = uwCaustic( cp, uTime * 0.55 );
    float ca2 = uwCaustic( cp * 1.7 + 1.3, uTime * 0.43 + 2.0 );
    float cst = ( ca * 0.7 + ca2 * 0.5 ) * upF * depthF * uCaustic * uMatCaustic;
    float uwSh = 1.0;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      uwSh = receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
    #endif
    outgoingLight += diffuseColor.rgb * uSunCol * cst * 1.35 * uwSh;
    // depth-relative falloff: surfaces below the camera receive less daylight
    float rel = clamp( exp( ( vUwPos.y - uCamY ) / 55.0 ), 0.45, 1.6 );
    outgoingLight *= mix( 1.0, rel, 0.85 );
  }
  #include <opaque_fragment>`,
        );
  };
  mat.customProgramCacheKey = () => 'uw-' + o.key;
  return mat;
}

/** Vertex snippet: sway along +Y for plants (origin at base). */
export const SWAY_VERTEX = /* glsl */ `
  {
    float phase = 0.0;
    #ifdef USE_INSTANCING
      phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
    #endif
    float hgt = max( position.y, 0.0 );
    float k = hgt * hgt * SWAY_AMT;
    transformed.x += sin( uTime * 1.1 + phase + hgt * 0.8 ) * k;
    transformed.z += cos( uTime * 0.83 + phase * 1.3 + hgt * 0.6 ) * k * 0.7;
  }
`;
