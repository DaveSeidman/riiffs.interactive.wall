// Give the astronaut its own directional lighting while retaining Three's physical
// material BRDF, skin normals, gold visor reflections, and material roughness.
export function prepareAstronautMaterial(source) {
  const material=source.clone();
  const metal=material.metalness>.6;
  const white=!metal && material.color && Math.min(material.color.r,material.color.g,material.color.b)>.35;
  if(white){material.roughness=.24;material.roughnessMap=null;}
  const depthLight={value:1};
  material.userData.depthLight=depthLight;
  material.envMapIntensity=metal ? .22 : .055;
  material.color?.multiplyScalar(.72);
  if(material.clearcoat>0){
    material.clearcoat=Math.min(material.clearcoat,.28);
    material.clearcoatRoughness=Math.max(material.clearcoatRoughness,.23);
  }
  if(material.emissiveIntensity>.3)material.emissiveIntensity=.3;
  material.onBeforeCompile=shader=>{
    shader.uniforms.uAstronautDepthLight=depthLight;
    shader.fragmentShader='uniform float uAstronautDepthLight;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',`
      #include <lights_fragment_begin>
      // Exclude the broad product studio lighting from this character only.
      reflectedLight.directDiffuse=vec3(0.);
      reflectedLight.directSpecular=vec3(0.);
      clearcoatSpecularDirect=vec3(0.);
      sheenSpecularDirect=vec3(0.);
      irradiance=vec3(.018,.022,.035);
      IncidentLight astronautLight;
      astronautLight.visible=true;
      // High side key: bright shoulders, shaded opposite side, readable folds.
      astronautLight.direction=normalize(mat3(viewMatrix)*vec3(-.85,.70,.42));
      astronautLight.color=vec3(2.10,2.00,1.82);
      RE_Direct(astronautLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
      // Cool rear rim separates the helmet, backpack and limbs from space.
      astronautLight.direction=normalize(mat3(viewMatrix)*vec3(.85,.25,-.65));
      astronautLight.color=vec3(.20,.36,.78);
      RE_Direct(astronautLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
      // Very restrained fill keeps the dark side visible without flattening it.
      astronautLight.direction=normalize(mat3(viewMatrix)*vec3(.50,-.20,.85));
      astronautLight.color=vec3(.055,.075,.12);
      RE_Direct(astronautLight,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
    `);
  };
    // Scale the complete character lighting, including environment reflections and lamps.
  const compile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    compile(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight *= uAstronautDepthLight;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey=()=> 'astronaut-directional-v2';
  return material;
}
