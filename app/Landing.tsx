"use client";

import { useEffect, useRef } from "react";

const PRISM_FS = `precision highp float;
uniform float u_time; uniform vec2 u_res; uniform float u_boost;
vec3 spectrum(float t){
  t=clamp(t,0.0,1.0);
  vec3 c0=vec3(0.780,0.713,1.000); vec3 c1=vec3(0.682,0.760,1.000);
  vec3 c2=vec3(0.498,0.713,1.000); vec3 c3=vec3(0.662,0.894,0.960);
  float x=t*3.0;
  if(x<1.0) return mix(c0,c1,x);
  if(x<2.0) return mix(c1,c2,x-1.0);
  return mix(c2,c3,x-2.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0=p1-p0, e1=p2-p1, e2=p0-p2;
  vec2 v0=p-p0, v1=p-p1, v2=p-p2;
  vec2 pq0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.0,1.0);
  vec2 pq1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.0,1.0);
  vec2 pq2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.0,1.0);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(pq0,pq0),s*(v0.x*e0.y-v0.y*e0.x)),
                 vec2(dot(pq1,pq1),s*(v1.x*e1.y-v1.y*e1.x))),
                 vec2(dot(pq2,pq2),s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.02; a*=0.5; } return s; }
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  float t=u_time;
  vec3 col=vec3(0.0);
  vec2 A=vec2(-0.05, 0.235); vec2 B=vec2(-0.30,-0.205); vec2 C=vec2( 0.20,-0.205);
  vec2 o=vec2(0.055,-0.042); vec2 A2=A+o, B2=B+o, C2=C+o;
  float sdF=sdTri(uv,A,B,C);
  vec2 P1=vec2(-0.175,0.018); vec2 P2=vec2( 0.090,0.000);
  float sdR=min(sdTri(uv,A,C,C2),sdTri(uv,A,C2,A2));
  float sdBt=min(sdTri(uv,B,C,C2),sdTri(uv,B,C2,B2));
  float inR=smoothstep(0.004,-0.004,sdR); float inBt=smoothstep(0.004,-0.004,sdBt);
  col += vec3(0.045,0.055,0.085)*inR; col += vec3(0.03,0.04,0.065)*inBt;
  float be=min(min(sdSeg(uv,A2,B2),sdSeg(uv,B2,C2)),sdSeg(uv,C2,A2));
  float ce=min(min(sdSeg(uv,A,A2),sdSeg(uv,B,B2)),sdSeg(uv,C,C2));
  col += vec3(0.30,0.36,0.55)*exp(-be*be/0.00003)*0.5;
  col += vec3(0.34,0.40,0.60)*exp(-ce*ce/0.00003)*0.55;
  vec2 bA=vec2(-3.0,0.085);
  float beam=sdSeg(uv,bA,P1);
  float beamMask=smoothstep(0.0,0.03,(P1.x+0.015)-uv.x);
  float pulse=0.9+0.1*sin(t*1.8);
  col += vec3(1.0)*(exp(-beam*beam/0.00004)*1.25 + exp(-beam*beam/0.0013)*0.45)*beamMask*pulse;
  float trv=fract(t*0.30);
  vec2 pp=mix(bA,P1,trv); float pd=length(uv-pp);
  col += vec3(1.0,1.0,1.0)*exp(-pd*pd/0.0016)*beamMask*0.85;
  float inF=smoothstep(0.003,-0.006,sdF);
  float vg=smoothstep(-0.205,0.235,uv.y);
  float gn = fbm(uv*23.0 + vec2(0.0, t*0.05));
  float gn2= fbm(uv*58.0 - vec2(t*0.04, 0.0));
  float grain = mix(gn,gn2,0.5);
  float spk = hash21(floor(uv*520.0));
  vec3 frostBase = mix(vec3(0.10,0.12,0.17), vec3(0.21,0.24,0.31), vg);
  col += frostBase*inF*(0.5 + 0.6*grain);
  col += vec3(0.62,0.68,0.82)*inF*smoothstep(0.07,0.235,uv.y)*(0.08+0.13*grain);
  float ib=sdSeg(uv,P1,P2);
  col += vec3(0.9,0.93,1.0)*exp(-ib*ib/0.0045)*inF*(0.35+0.45*grain);
  col += vec3(1.0)*exp(-ib*ib/0.0007)*inF*0.28;
  float lowerBody=smoothstep(0.07,-0.205,uv.y);
  col += spectrum(clamp((uv.x+0.18)/0.36 + (grain-0.5)*0.16,0.0,1.0))*inF*lowerBody*(0.11+0.17*grain);
  col += vec3(1.0)*step(0.991,spk)*inF*(0.18+0.2*grain);
  col += vec3(0.05,0.06,0.09)*(inR+inBt)*grain*0.5;
  float ef=min(min(sdSeg(uv,A,B),sdSeg(uv,B,C)),sdSeg(uv,C,A));
  col += vec3(0.92,0.96,1.0)*exp(-ef*ef/0.000018)*1.15;
  col += vec3(0.45,0.55,0.85)*exp(-max(ef,0.0)*max(ef,0.0)/0.0010)*0.22;
  float glint=sdSeg(uv,mix(A,B,0.18),mix(A,B,0.5));
  col += vec3(1.0)*exp(-glint*glint/0.00003)*0.7;
  vec2 v=uv-P2; float dist=length(v); float ang=atan(v.y,v.x);
  float centerAng=-0.16, halfA=0.34;
  float fanPos=(ang-(centerAng-halfA))/(2.0*halfA);
  float inFan=smoothstep(0.0,0.05,fanPos)*smoothstep(1.0,0.95,fanPos);
  float rightMask=smoothstep(-0.01,0.03,v.x);
  float rad=smoothstep(0.0,0.05,dist)*exp(-dist*0.55)*(1.0+0.5*smoothstep(0.9,1.0,trv));
  float hue=clamp(1.0-fanPos,0.0,1.0);
  vec3 rb=spectrum(hue);
  float streak=0.8+0.2*cos(fanPos*6.2831*6.0 - dist*7.0 + t*1.8);
  col += rb*inFan*rightMask*rad*1.7*streak;
  col += rb*inFan*rightMask*exp(-dist*0.4)*0.34;
  col += vec3(1.0,0.98,0.95)*exp(-dot(v,v)/0.0005)*0.9;
  col*=u_boost;
  float a=clamp(max(max(col.r,col.g),col.b),0.0,1.0);
  a=pow(a,0.82); col=col/(1.0+col*0.30);
  gl_FragColor=vec4(col,a);
}`;

const ORB_FS = `precision highp float;
uniform float u_time; uniform vec2 u_res;
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m; m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0; vec3 hh=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+hh*hh);
  vec3 g; g.x=a0.x*x0.x+hh.x*x0.y; g.yz=a0.yz*x12.xz+hh.yz*x12.yw;
  return 130.0*dot(m,g);
}
float fbm(vec2 p){float s=0.0,a=0.5; for(int i=0;i<5;i++){s+=a*snoise(p); p*=2.02; a*=0.5;} return s;}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*u_res)/min(u_res.x,u_res.y);
  uv*=2.0; float r=length(uv);
  float T=u_time*0.40+23.0;
  vec2 p=mod(uv*2.8,6.28318530718)-250.0; vec2 ii=p; float c=1.0; float inten=0.0045;
  for(int n=0;n<5;n++){ float t=T*(1.0-(3.5/float(n+1)));
    ii=p+vec2(cos(t-ii.x)+sin(t+ii.y), sin(t-ii.y)+cos(t+ii.x));
    c+=1.0/length(vec2(p.x/(sin(ii.x+t)/inten), p.y/(cos(ii.y+t)/inten))); }
  c/=5.0; c=1.17-pow(c,1.4);
  float caustic=clamp(pow(abs(c),5.0),0.0,1.0);
  float vgrad=clamp(uv.y*0.45+0.55,0.0,1.0);
  vec3 deep=vec3(0.34,0.55,0.92); vec3 soft=vec3(0.58,0.75,1.000);
  vec3 base=mix(deep,soft,vgrad); base=mix(base,vec3(0.760,0.700,1.000),0.12);
  vec3 hi=vec3(0.80,0.90,1.000);
  vec3 col=base + hi*caustic*0.50; col+=vec3(0.55,0.74,1.0)*caustic*caustic*0.14;
  float tex=fbm(uv*5.0 + caustic*1.3 + vec2(u_time*0.05,-u_time*0.03));
  col*=0.84+0.26*tex;
  float g=fbm(uv*15.0+vec2(u_time*0.06,-u_time*0.05)); col+=(g-0.5)*0.11;
  float sp=fract(sin(dot(floor(uv*300.0),vec2(12.9898,78.233)))*43758.5453); col+=(sp-0.5)*0.085;
  col*=1.0-0.10*smoothstep(0.55,1.05,r);
  float edge=smoothstep(1.0,0.984,r); col=clamp(col,0.0,1.0);
  gl_FragColor=vec4(col,edge);
}`;

const VS = `attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }`;

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    const cleanups: (() => void)[] = [];

    function compile(gl: WebGLRenderingContext, fs: string) {
      const prog = gl.createProgram()!;
      const vsh = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vsh, VS); gl.compileShader(vsh); gl.attachShader(prog, vsh);
      const fsh = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fsh, fs); gl.compileShader(fsh); gl.attachShader(prog, fsh);
      gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      return prog;
    }

    // ---- interactive wave (2D) ----
    (function () {
      const canvas = root.querySelector<HTMLCanvasElement>("#wave");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const STOPS: [number, string][] = [
        [0, "#C7B6FF"], [0.26, "#AEC2FF"], [0.5, "#7FB6FF"], [0.74, "#A9E4F5"], [1, "#C7B6FF"],
      ];
      const N = 8;
      let W = 0, H = 0, grad: CanvasGradient | null = null;
      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = canvas!.clientWidth; H = canvas!.clientHeight;
        canvas!.width = Math.round(W * dpr); canvas!.height = Math.round(H * dpr);
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        grad = ctx!.createLinearGradient(0, 0, W, 0);
        STOPS.forEach((s) => grad!.addColorStop(s[0], s[1]));
      }
      resize();
      window.addEventListener("resize", resize);
      let tmx = -9999, tmy = 0, tact = 0, mx = -9999, my = 0, act = 0;
      const onMove = (e: PointerEvent) => {
        const rct = canvas!.getBoundingClientRect();
        tmx = e.clientX - rct.left; tmy = e.clientY - rct.top; tact = 1;
      };
      const onLeave = () => { tact = 0; };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      const base = (x: number, t: number) =>
        13 * Math.sin(x * 0.0058 + t * 0.85) + 13 * 0.42 * Math.sin(x * 0.0029 - t * 0.6 + 1.2);
      const thick = (x: number) => 1 - 0.62 * Math.exp(-Math.pow((x - W * 0.5) / (W * 0.3), 2));
      const t0 = performance.now();
      let raf = 0;
      function frame(now: number) {
        const t = reduce ? 2 : (now - t0) / 1000;
        mx += (tmx - mx) * 0.12; my += (tmy - my) * 0.12; act += (tact - act) * 0.08;
        ctx!.clearRect(0, 0, W, H);
        ctx!.lineJoin = "round"; ctx!.lineCap = "round"; ctx!.strokeStyle = grad!;
        ctx!.lineWidth = 1.4; ctx!.globalAlpha = 0.92;
        const cy = H * 0.5, gap = 14, step = Math.max(2, Math.floor(W / 320));
        for (let j = 0; j < N; j++) {
          const off = j - (N - 1) / 2;
          ctx!.beginPath();
          for (let x = 0; x <= W; x += step) {
            const th = thick(x), bx = base(x, t);
            let bend = 0;
            if (act > 0.001) {
              const infl = Math.exp(-Math.pow((x - mx) / 160, 2));
              bend = (my - (cy + bx)) * 0.4 * infl * act;
            }
            const y = cy + bx + bend + off * gap * th + 3 * th * Math.sin(x * 0.01 + t * 1.25 + j * 0.5);
            if (x === 0) ctx!.moveTo(x, y); else ctx!.lineTo(x, y);
          }
          ctx!.stroke();
        }
        if (!reduce) raf = requestAnimationFrame(frame);
      }
      if (reduce) frame(t0); else raf = requestAnimationFrame(frame);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
      });
    })();

    // ---- prism FX (WebGL) + scroll parallax ----
    (function () {
      const canvas = root.querySelector<HTMLCanvasElement>("#prismFX");
      if (!canvas) return;
      const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
      if (!gl) { canvas.classList.add("no-webgl"); return; }
      const prog = compile(gl, PRISM_FS);
      const Ut = gl.getUniformLocation(prog, "u_time");
      const Ur = gl.getUniformLocation(prog, "u_res");
      const Ub = gl.getUniformLocation(prog, "u_boost");
      function size() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas!.clientWidth || 900, h = canvas!.clientHeight || 440;
        canvas!.width = w * dpr; canvas!.height = h * dpr; gl!.viewport(0, 0, canvas!.width, canvas!.height);
      }
      size();
      window.addEventListener("resize", size);
      let raf = 0;
      function frame(ts: number) {
        gl!.uniform1f(Ut, ts * 0.001); gl!.uniform1f(Ub, 1);
        gl!.uniform2f(Ur, canvas!.width, canvas!.height);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
        if (!reduce) raf = requestAnimationFrame(frame);
      }
      if (reduce) frame(600); else raf = requestAnimationFrame(frame);

      const sec = root.querySelector<HTMLElement>(".prism-section");
      let ticking = false;
      function upd() {
        if (!sec) return;
        const rct = sec.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const prog2 = Math.max(0, Math.min(1, (vh - rct.top) / (vh + rct.height)));
        canvas!.style.transform = "translate3d(0," + ((prog2 - 0.5) * 64).toFixed(1) + "px,0)";
        ticking = false;
      }
      const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } };
      upd();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", size);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      });
    })();

    // ---- CTA orb (WebGL, noisy) ----
    (function () {
      const canvas = root.querySelector<HTMLCanvasElement>("#ctaOrb");
      if (!canvas) return;
      const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true, alpha: true });
      if (!gl || reduce) {
        canvas.classList.add("orb-fallback");
        canvas.style.borderRadius = "50%";
        return;
      }
      const prog = compile(gl, ORB_FS);
      const Ut = gl.getUniformLocation(prog, "u_time");
      const Ur = gl.getUniformLocation(prog, "u_res");
      function size() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas!.clientWidth || 192, h = canvas!.clientHeight || 192;
        canvas!.width = w * dpr; canvas!.height = h * dpr; gl!.viewport(0, 0, canvas!.width, canvas!.height);
      }
      size();
      window.addEventListener("resize", size);
      let raf = 0;
      function frame(ts: number) {
        gl!.uniform1f(Ut, ts * 0.001);
        gl!.uniform2f(Ur, canvas!.width, canvas!.height);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", size);
      });
    })();

    // ---- scroll reveal + count-up + bar grow ----
    (function () {
      const els = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
      function countup(el: HTMLElement) {
        const tgt = parseFloat(el.getAttribute("data-target") || "0") || 0;
        let s0: number | null = null;
        const dur = 1100;
        function step(ts: number) {
          if (s0 === null) s0 = ts;
          const k = Math.min(1, (ts - s0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          el.textContent = String(Math.round(tgt * e));
          if (k < 1) requestAnimationFrame(step);
          else el.textContent = String(tgt);
        }
        requestAnimationFrame(step);
      }
      function fire(scope: HTMLElement) {
        scope.querySelectorAll<HTMLElement>(".countup").forEach((c) => {
          if (!c.dataset.done) { c.dataset.done = "1"; countup(c); }
        });
      }
      if (!("IntersectionObserver" in window) || reduce) {
        els.forEach((el) => el.classList.add("in"));
        fire(root);
        return;
      }
      const io = new IntersectionObserver(
        (ents) => {
          ents.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("in");
              fire(en.target as HTMLElement);
              io.unobserve(en.target);
            }
          });
        },
        { threshold: 0.16, rootMargin: "0px 0px -7% 0px" }
      );
      els.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    })();

    return () => cleanups.forEach((c) => c());
  }, []);

  const TriNav = (
    <svg width="26" height="26" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ldlg" x1="0" y1="0" x2="30" y2="30">
          <stop offset="0" stopColor="#7A5CFF" /><stop offset=".5" stopColor="#16C5E6" /><stop offset="1" stopColor="#FF5CA8" />
        </linearGradient>
      </defs>
      <path d="M15 3 L26 24 L4 24 Z" stroke="url(#ldlg)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M2 14 L11 16" stroke="#47474E" strokeWidth="1.5" />
      <path d="M19 15.5 L29 10.5" stroke="#7A5CFF" strokeWidth="1.5" />
      <path d="M19 17.5 L29 17" stroke="#16C5E6" strokeWidth="1.5" />
      <path d="M19 19.5 L29 23" stroke="#FF5CA8" strokeWidth="1.5" />
    </svg>
  );

  return (
    <div className="prism-ld" ref={rootRef}>
      <nav className="nav"><div className="wrap in">
        <div className="logo">{TriNav}<span className="wm">Prism</span></div>
        <div className="links"><a href="#how">How it works</a><a href="#who">Who it&apos;s for</a><a href="#">Pricing</a></div>
        <div className="r"><a className="btn btn-ghost btn-sm" href="/researcher">Sign in</a><a className="btn btn-dark btn-sm" href="/researcher">Start free</a></div>
      </div></nav>

      <header className="hero">
        <div className="shader" aria-hidden="true">
          <div className="cols"><span className="col"></span><span className="col"></span><span className="col"></span><span className="col"></span><span className="col"></span><span className="col"></span></div>
          <span className="toplav"></span>
          <span className="bloom b1"></span><span className="bloom b2"></span><span className="bloom b3"></span>
          <span className="veil"></span><span className="grain"></span><span className="fade"></span>
        </div>
        <div className="wrap hero-in">
          <span className="chip"><span className="chip-in">For designers, PMs &amp; researchers</span></span>
          <h1>Talk to more users<br />than you have time&nbsp;for.</h1>
          <p className="lede">An AI interviewer that runs your user interviews <em>for</em> you — so you read the insight, not the transcript.</p>
          <div className="cta">
            <a className="btn btn-dark" href="/researcher">Start free →</a>
            <a className="btn btn-ghost" href="/researcher">See the dashboard <span className="arr">→</span></a>
          </div>
        </div>
      </header>

      <section className="wave-band" aria-label="Interactive gradient wave"><canvas id="wave"></canvas></section>

      <section className="logos"><div className="wrap in">
        <span className="pb">Powered by</span>
        <a className="lg" href="#">ElevenLabs</a><a className="lg" href="#">Claude</a><a className="lg" href="#">Voyage AI</a>
      </div></section>

      <section className="prism-section" aria-label="One conversation, refracted into insight">
        <div className="prism-card">
          <div className="prism-copy">
            <h2 className="prism-h">White light in. The full spectrum out.</h2>
            <p className="prism-sub">One raw conversation enters the prism. Prism refracts it into the bands that matter — so you read insight, not transcripts.</p>
          </div>
          <div className="prism-fx-wrap"><canvas id="prismFX"></canvas></div>
          <div className="prism-chips">
            <span className="pchip raw"><i style={{ ["--c" as string]: "#FFFFFF" }}></i>Raw conversation</span>
            <span className="pchip"><i style={{ ["--c" as string]: "#C7B6FF" }}></i>Summary</span>
            <span className="pchip"><i style={{ ["--c" as string]: "#AEC2FF" }}></i>Themes</span>
            <span className="pchip"><i style={{ ["--c" as string]: "#7FB6FF" }}></i>Sentiment</span>
            <span className="pchip"><i style={{ ["--c" as string]: "#A9E4F5" }}></i>Pain points</span>
          </div>
        </div>
      </section>

      <section className="how" id="how" aria-label="How it works">
        <span className="seqgrid" aria-hidden="true"></span>
        <div className="gbox how-box">
          <span className="px tl"></span><span className="px tr"></span><span className="px bl"></span><span className="px br"></span>
          <span className="chip"><span className="chip-in">How it works</span></span>
          <h2 className="how-h">You set it up once.<br />Prism does the rest.</h2>
          <p className="how-sub">No scheduling, no moderating, no note-taking, no transcribing.</p>
          <div className="steps">
            <div className="step s1"><span className="num">01</span><span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span><h3>Define your study</h3><p>Write what you want to learn, add your questions, drop in product context.</p></div>
            <div className="step s2"><span className="num">02</span><span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></svg></span><h3>Share one link</h3><p>Send it to your users. Prism interviews each of them by voice, on their time.</p></div>
            <div className="step s3"><span className="num">03</span><span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg></span><h3>Read the insight</h3><p>Themes, quotes, sentiment, and pain points — across every conversation.</p></div>
          </div>
        </div>
      </section>

      <section className="dash" id="dash" aria-label="The dashboard">
        <span className="seqgrid" aria-hidden="true"></span>
        <div className="gbox dash-box">
          <span className="px tl"></span><span className="px tr"></span><span className="px bl"></span><span className="px br"></span>
          <div className="sec-head center reveal">
            <span className="chip"><span className="chip-in">The dashboard</span></span>
            <h2 className="sec-h">Every interview, refracted into a report.</h2>
            <p className="sec-sub">Skim the spectrum or dive into the evidence — every study, in one clean view.</p>
          </div>
          <div className="preview-frame reveal" data-d="1">
            <div className="preview-bar"><span className="dots"><i></i><i></i><i></i></span><span className="url">app.prism.studio / studies / design-system-v0</span></div>
            <div className="preview-app">
              <aside className="pv-rail">
                <div className="pv-logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3 21 19H3z" stroke="#7A5CFF" strokeWidth="1.7" strokeLinejoin="round" /></svg> Prism</div>
                <a className="active"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></svg> Overview</a>
                <a><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" /><path d="M14 6l4 4" /></svg> Interviews</a>
                <a><svg viewBox="0 0 24 24"><path d="M12 3 21 19H3z" /></svg> Themes</a>
                <a><svg viewBox="0 0 24 24"><path d="M5 4h14M5 9h14M5 14h10M5 19h7" /></svg> Evidence</a>
                <div className="pv-rail-sp"></div>
                <div className="pv-rail-foot"><span className="pv-av"></span> Karthik</div>
              </aside>
              <div className="pv-main">
                <div className="pv-head">
                  <div><div className="pv-title">Design system study</div><div className="pv-meta">24 interviews · updated 3m ago</div></div>
                  <div className="pv-controls"><span className="seg"><b>Overview</b><i>Themes</i></span><span className="pv-btn">Export</span></div>
                </div>
                <div className="pv-kpis">
                  <div className="pv-kpi"><div className="l">Interviews</div><div className="v"><span className="countup" data-target="24">0</span> <small>+6</small></div><svg className="spark" viewBox="0 0 52 18" preserveAspectRatio="none" fill="none"><polyline points="0,15 8.6,13 17,14 26,8 34,9 43,4 52,3" stroke="#6B6FD8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                  <div className="pv-kpi"><div className="l">Avg sentiment</div><div className="v">+0.42</div><svg className="spark" viewBox="0 0 52 18" preserveAspectRatio="none" fill="none"><polyline points="0,11 8.6,12 17,9 26,10 34,6 43,7 52,5" stroke="#C9C9D0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                  <div className="pv-kpi"><div className="l">Themes found</div><div className="v"><span className="countup" data-target="9">0</span></div><svg className="spark" viewBox="0 0 52 18" preserveAspectRatio="none" fill="none"><polyline points="0,14 8.6,11 17,12 26,7 34,8 43,5 52,6" stroke="#C9C9D0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                  <div className="pv-kpi"><div className="l">Time to insight</div><div className="v">3m</div><svg className="spark" viewBox="0 0 52 18" preserveAspectRatio="none" fill="none"><polyline points="0,5 8.6,7 17,6 26,9 34,8 43,11 52,12" stroke="#C9C9D0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                </div>
                <div className="pv-panels">
                  <div className="pv-card">
                    <h4>Theme distribution <span>last 30 days</span></h4>
                    <div className="trow lead"><div className="tn">Onboarding friction</div><div className="tbar"><span style={{ ["--w" as string]: "92%" }}></span></div><div className="tc">22</div></div>
                    <div className="trow"><div className="tn">Pricing clarity</div><div className="tbar"><span style={{ ["--w" as string]: "74%" }}></span></div><div className="tc">18</div></div>
                    <div className="trow"><div className="tn">Search &amp; filters</div><div className="tbar"><span style={{ ["--w" as string]: "61%" }}></span></div><div className="tc">15</div></div>
                    <div className="trow"><div className="tn">Mobile UX</div><div className="tbar"><span style={{ ["--w" as string]: "48%" }}></span></div><div className="tc">12</div></div>
                    <div className="trow"><div className="tn">Integrations</div><div className="tbar"><span style={{ ["--w" as string]: "33%" }}></span></div><div className="tc">8</div></div>
                  </div>
                  <div className="pv-card pv-table">
                    <h4>Sentiment by theme</h4>
                    <div className="tr"><span className="nm"><span className="dot" style={{ background: "#5A9E7E" }}></span>Onboarding</span><span className="mt">+0.51</span></div>
                    <div className="tr"><span className="nm"><span className="dot" style={{ background: "#BFA15A" }}></span>Pricing</span><span className="mt">+0.08</span></div>
                    <div className="tr"><span className="nm"><span className="dot" style={{ background: "#5A9E7E" }}></span>Search</span><span className="mt">+0.37</span></div>
                    <div className="tr"><span className="nm"><span className="dot" style={{ background: "#C08A8A" }}></span>Mobile</span><span className="mt">−0.12</span></div>
                    <div className="tr"><span className="nm"><span className="dot" style={{ background: "#5A9E7E" }}></span>Integrations</span><span className="mt">+0.29</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="who" id="who" aria-label="Who it's for">
        <span className="seqgrid" aria-hidden="true"></span>
        <div className="gbox who-box">
          <span className="px tl"></span><span className="px tr"></span><span className="px bl"></span><span className="px br"></span>
          <span className="chip"><span className="chip-in">Who it&apos;s for</span></span>
          <h2 className="who-h">Built for the one person who&apos;d rather<br />talk to users than schedule calls.</h2>
          <div className="roles">
            <span className="role"><i style={{ ["--c" as string]: "#8B79D8" }}></i>Product designers</span>
            <span className="role"><i style={{ ["--c" as string]: "#6E86D8" }}></i>Product managers</span>
            <span className="role"><i style={{ ["--c" as string]: "#5C8FE0" }}></i>UX researchers</span>
            <span className="role"><i style={{ ["--c" as string]: "#3FA6C6" }}></i>Founders</span>
          </div>
          <p className="who-quote">&ldquo;I talked to 30 users in a week — by myself, between meetings.&rdquo;<span className="by">— a researcher who stopped scheduling calls</span></p>
        </div>
      </section>

      <section className="endcta" aria-label="Get started">
        <div className="cta-card">
          <div className="cta-strips" aria-hidden="true">
            <div className="ccols"><span className="ccol"></span><span className="ccol"></span><span className="ccol"></span><span className="ccol"></span><span className="ccol"></span><span className="ccol"></span></div>
            <span className="cbloom cb1"></span><span className="cbloom cb2"></span>
            <span className="cveil"></span><span className="cfade"></span>
          </div>
          <div className="cta-in">
            <div className="cta-orb-wrap"><canvas id="ctaOrb" className="cta-orb" width="384" height="384" aria-hidden="true"></canvas></div>
            <h2 className="cta-h">Run your first study tonight.</h2>
            <p className="cta-sub">Define an objective, share a link, and wake up to insight. Free to start.</p>
            <div className="cta-actions">
              <a className="btn btn-dark" href="/researcher">Start free</a>
              <a className="btn btn-ghost" href="#how">See how it works</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="foot-in">
          <a className="foot-brand" href="#"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 21 19H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>Prism</a>
          <nav className="foot-nav"><a href="#how">How it works</a><a href="#who">Who it&apos;s for</a><a href="#">Pricing</a><a href="/researcher">Sign in</a></nav>
          <span className="foot-copy">© 2026 Prism</span>
        </div>
      </footer>
    </div>
  );
}
