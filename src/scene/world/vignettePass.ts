import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export function createVignettePass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      strength: { value: 0.85 },
      offset: { value: 0.2 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float strength;
      uniform float offset;
      varying vec2 vUv;

      float vignette(vec2 uv) {
        vec2 p = uv - 0.5;
        float r = length(p);
        float v = smoothstep(0.35 + offset, 0.85 + offset, r);
        return 1.0 - v * strength;
      }

      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float v = vignette(vUv);
        gl_FragColor = vec4(c.rgb * v, c.a);
      }
    `
  });
}
