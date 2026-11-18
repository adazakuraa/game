import * as THREE from 'three';

/** Shared uniforms referenced by every injected shader (update once per frame). */
export const UW = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.25, 1, 0.35).normalize() },
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
};

/**
 * Inject underwater lighting into a stock MeshStandardMaterial: projected caustics on up-facing
 * surfaces and depth-relative light falloff. Optional extra vertex/fragment hooks share the
 * same compile so materials keep one program each.
 */
export function underwaterMaterial<T extends THREE.MeshStandardMaterial>(mat: T, o: InjectOpts): T {
  const strength = o.caustic ?? 1;
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
    outgoingLight += diffuseColor.rgb * uSunCol * cst * 1.35;
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
