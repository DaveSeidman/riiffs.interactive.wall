"""Bind this astronaut using continuous suit weights and rigid equipment islands.
Run in Blender with astronaut-rig.blend open. Coordinates are model-specific metres.
"""
import bpy
from mathutils import Vector

rig = bpy.data.objects['Astronaut_Rig']
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def mode(value):
    choices = [i.identifier for i in bpy.ops.object.mode_set.get_rna_type().properties['mode'].enum_items]
    bpy.ops.object.mode_set(mode=next(i for i in choices if i == value))
if bpy.context.object and bpy.context.object.mode != 'OBJECT': mode('OBJECT')
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
mode('EDIT')
joints = {
    'pelvis': ((0,-.09,.93),(0,-.09,1.08)),
    'spine': ((0,-.09,1.08),(0,-.09,1.30)),
    'chest': ((0,-.09,1.30),(0,-.09,1.50)),
    'neck': ((0,-.09,1.50),(0,-.12,1.58)),
    'head': ((0,-.12,1.58),(0,-.12,1.82)),
}
for side, sign in [('L',1),('R',-1)]:
    def p(x,y,z): return (sign*x,y,z)
    joints.update({
        'clavicle.'+side: (p(.04,-.09,1.46),p(.25,-.09,1.44)),
        'upper_arm.'+side: (p(.25,-.09,1.44),p(.395,-.105,1.27)),
        'forearm.'+side: (p(.395,-.105,1.27),p(.52,-.17,1.06)),
        'hand.'+side: (p(.52,-.17,1.06),p(.58,-.22,.89)),
        'thigh.'+side: (p(.16,-.09,.93),p(.19,-.10,.55)),
        'shin.'+side: (p(.19,-.10,.55),p(.22,-.06,.18)),
        'foot.'+side: (p(.22,-.06,.18),p(.24,-.23,.06)),
    })
for name,(head,tail) in joints.items():
    rig.data.edit_bones[name].head=head
    rig.data.edit_bones[name].tail=tail
mode('OBJECT')

def smooth(a,b,x):
    t=max(0.,min(1.,(x-a)/(b-a)))
    return t*t*(3.-2.*t)
def blend(a,b,t):
    result={k:v*(1-t) for k,v in a.items()}
    for k,v in b.items(): result[k]=result.get(k,0)+v*t
    return {k:v for k,v in result.items() if v>1e-6}
def weights(p):
    x,y,z=p; side='L' if x>=0 else 'R'; x=abs(x)
    torso=blend({'pelvis':1},{'spine':1},smooth(1.03,1.17,z))
    torso=blend(torso,{'chest':1},smooth(1.22,1.34,z))
    torso=blend(torso,{'neck':1},smooth(1.49,1.57,z))
    torso=blend(torso,{'head':1},smooth(1.57,1.63,z))
    leg=blend({'foot.'+side:1},{'shin.'+side:1},smooth(.16,.25,z))
    leg=blend(leg,{'thigh.'+side:1},smooth(.48,.64,z))
    body=blend(leg,torso,smooth(.86,1.02,z))
    arm=blend({'hand.'+side:1},{'forearm.'+side:1},smooth(1.025,1.10,z))
    arm=blend(arm,{'upper_arm.'+side:1},smooth(1.22,1.32,z))
    # Shoulder blend follows the suit's sloping armpit rather than a vertical cut.
    boundary=.26 + max(0.,1.34-z)*.24
    arm_mix=smooth(boundary-.045,boundary+.055,x)*smooth(.70,.82,z)
    return blend(body,arm,arm_mix)

def components(mesh):
    parents=list(range(len(mesh.vertices)))
    def find(a):
        while parents[a]!=a:
            parents[a]=parents[parents[a]];a=parents[a]
        return a
    for e in mesh.edges:
        a,b=map(find,e.vertices); parents[a]=b
    result={}
    for v in mesh.vertices: result.setdefault(find(v.index),[]).append(v.index)
    return result.values()

for o in meshes:
    o.vertex_groups.clear()
    groups={b.name:o.vertex_groups.new(name=b.name) for b in rig.data.bones if b.use_deform}
    coords=[o.matrix_world@v.co for v in o.data.vertices]
    backpack='.002' in o.name
    soft=any(s in o.name for s in ('Rubber','Suit -','Harness','Safety','Badge','Insignia'))
    for ids in components(o.data):
        center=sum((coords[i] for i in ids),Vector())/len(ids)
        zmin=min(coords[i].z for i in ids)
        zmax=max(coords[i].z for i in ids)
        rigid=None
        if backpack: rigid='chest'
        elif ('Shell' in o.name and zmax>1.8) or 'Visor' in o.name or 'Helmet lamp' in o.name: rigid='head'
        elif zmin>1.63: rigid='head'
        elif zmax<.17: rigid='foot.'+('L' if center.x>=0 else 'R')
        elif abs(center.x)>.5 and center.z<1.055: rigid='hand.'+('L' if center.x>=0 else 'R')
        elif not soft:
            w=weights(center)
            rigid=max(w,key=w.get)
            # Helmet collar stays attached to the torso.
            if center.z>1.48 and abs(center.x)<.22: rigid='chest'
        if rigid: groups[rigid].add(ids,1.,'REPLACE')
        else:
            for i in ids:
                w=weights(coords[i])
                top=sorted(w.items(),key=lambda kv:kv[1],reverse=True)[:4]
                total=sum(v for _,v in top)
                for name,value in top: groups[name].add([i],value/total,'REPLACE')
    world=o.matrix_world.copy()
    o.parent=rig
    o.matrix_world=world
    mod=next((m for m in o.modifiers if m.type=='ARMATURE'),None)
    if mod is None:
        kind=next(i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items if i.identifier=='ARMATURE')
        mod=o.modifiers.new('Astronaut skin',kind)
    mod.object=rig
    mod.use_deform_preserve_volume=False  # Match glTF / Three.js linear skinning.
rig['rig_stage']='Skinned: continuous suit weights, rigid helmet/backpack/equipment; no physics'
bpy.context.view_layer.update()
errors=[]
for o in meshes:
    for v in o.data.vertices:
        total=sum(g.weight for g in v.groups)
        if abs(total-1)>1e-5 or len(v.groups)>4: errors.append((o.name,v.index,total))
assert not errors,errors[:10]
print('Bound',len(meshes),'meshes;',sum(len(o.data.vertices) for o in meshes),'vertices; normalized, max four weights.')
