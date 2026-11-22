// Live scene composite: two smooth horizontal light splines grow from the centre,
// then separate vertically to reveal the incoming universe through the opening.
export const sceneBlendFragment=`
uniform sampler2D outgoing,incoming;
uniform float amount,phase;uniform bool unzip;
varying vec2 vUv;
float ease(float t){t=clamp(t,0.,1.);return t*t*t*(t*(t*6.-15.)+10.);}
void main(){
 if(!unzip){gl_FragColor=mix(texture2D(outgoing,vUv),texture2D(incoming,vUv),amount);return;}
 float grow=ease(phase/.28);
 float opening=ease((phase-.25)/.65);
 float fade=1.-smoothstep(.80,1.,phase);
 float x=vUv.x-.5;
 float span=1.-smoothstep(grow*.52-.008,grow*.52+.008,abs(x));
 float bow=sin(vUv.x*3.14159265)*.025*sin(opening*3.14159265);
 // Send ripples from the middle toward both ends of the tear.
 float travel=sqrt(x*x+.0001)*34.-phase*18.;
 float tension=smoothstep(0.,.18,phase)*(1.-smoothstep(.58,.93,phase));
 float seam=tension*(.018*sin(travel)+.007*sin(travel*2.2+x*9.));
 float separation=sin(opening*3.14159265)*.023*sin(travel*1.4+x*5.);
 float halfGap=.002*grow+opening*.60+bow+separation;
 float seamY=vUv.y-.5-seam;
 float edge=abs(seamY)-halfGap;
 float reveal=(1.-smoothstep(-.003,.003,edge))*span*smoothstep(.25,.29,phase);
 float wake=exp(-abs(edge)*45.)*span*fade;
 vec2 uv=vUv;
 uv.y+=sign(seamY)*wake*.018*sin(opening*3.14159265);
 vec3 base=mix(texture2D(outgoing,vUv).rgb,texture2D(incoming,clamp(uv,0.,1.)).rgb,reveal);
 vec3 tint=mix(vec3(.20,.55,1.),vec3(1.,.12,.65),.5+.5*sin(x*7.+opening*3.));
 float core=exp(-abs(edge)*800.)*span*fade*smoothstep(0.,.05,phase);
 base+=tint*wake*.35*grow+mix(tint,vec3(1.),.8)*core*1.8;
 gl_FragColor=vec4(base,1.);
}`;
