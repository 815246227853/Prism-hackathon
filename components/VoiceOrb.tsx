"use client";

import { useEffect, useRef } from "react";

// Water-caustics voice orb, ported verbatim from the prototype's WebGL shader.
// Renders into a <canvas>; falls back to a CSS gradient when WebGL is unavailable
// or the user prefers reduced motion.
const ORB_FS = `precision highp float;uniform float u_time;uniform vec2 u_res;
  void main(){vec2 uv=(gl_FragCoord.xy-0.5*u_res)/min(u_res.x,u_res.y);uv*=2.0;float r=length(uv);
    float T=u_time*0.40+23.0;vec2 p=mod(uv*2.8,6.28318530718)-250.0;vec2 ii=p;float c=1.0;float inten=0.0045;
    for(int n=0;n<5;n++){float t=T*(1.0-(3.5/float(n+1)));ii=p+vec2(cos(t-ii.x)+sin(t+ii.y),sin(t-ii.y)+cos(t+ii.x));c+=1.0/length(vec2(p.x/(sin(ii.x+t)/inten),p.y/(cos(ii.y+t)/inten)));}
    c/=5.0;c=1.17-pow(c,1.4);float caustic=clamp(pow(abs(c),5.0),0.0,1.0);
    float vgrad=clamp(uv.y*0.45+0.55,0.0,1.0);vec3 deep=vec3(0.34,0.55,0.92);vec3 soft=vec3(0.58,0.75,1.0);
    vec3 base=mix(deep,soft,vgrad);base=mix(base,vec3(0.760,0.700,1.0),0.12);vec3 hi=vec3(0.80,0.90,1.0);
    vec3 col=base+hi*caustic*0.50;col+=vec3(0.55,0.74,1.0)*caustic*caustic*0.14;
    float g=fract(sin(dot(floor(uv*180.0),vec2(12.9898,78.233)))*43758.5453);col+=(g-0.5)*0.04;
    col*=1.0-0.10*smoothstep(0.55,1.05,r);float edge=smoothstep(1.0,0.984,r);gl_FragColor=vec4(clamp(col,0.0,1.0),edge);}`;
const ORB_VS = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

export function VoiceOrb({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;

    const gl = (cv.getContext("webgl", { premultipliedAlpha: false, alpha: true }) ||
      cv.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      cv.style.borderRadius = "50%";
      cv.style.background =
        "radial-gradient(circle at 40% 35%,#9FC7FF,#5C8FE0 60%,#7A5CFF)";
      return;
    }

    function sh(type: number, src: string) {
      const o = gl!.createShader(type)!;
      gl!.shaderSource(o, src);
      gl!.compileShader(o);
      return o;
    }
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, ORB_VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, ORB_FS));
    gl.linkProgram(pr);
    gl.useProgram(pr);

    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(pr, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uT = gl.getUniformLocation(pr, "u_time");
    const uR = gl.getUniformLocation(pr, "u_res");

    function rz() {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = cv!.clientWidth || 150;
      const h = cv!.clientHeight || 150;
      cv!.width = w * dpr;
      cv!.height = h * dpr;
      gl!.viewport(0, 0, cv!.width, cv!.height);
    }
    rz();
    window.addEventListener("resize", rz);

    let raf = 0;
    const t0 = performance.now();
    function fr(now: number) {
      rz();
      gl!.uniform1f(uT, reduce ? 6 : (now - t0) / 1000);
      gl!.uniform2f(uR, cv!.width, cv!.height);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(fr);
    }
    if (reduce) fr(t0 + 6000);
    else raf = requestAnimationFrame(fr);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", rz);
    };
  }, []);

  return <canvas ref={ref} className={className} />;
}
