import bpy
# Initial joint-placement pass. Skin weights deliberately follow after placement review.
assert not bpy.data.objects.get('Astronaut_Rig'), 'Rig already exists'
bpy.ops.object.select_all(action='DESELECT')
data=bpy.data.armatures.new('Astronaut_Skeleton')
rig=bpy.data.objects.new('Astronaut_Rig',data);bpy.context.collection.objects.link(rig)
rig.select_set(True);bpy.context.view_layer.objects.active=rig;rig.show_in_front=True
modes=[i.identifier for i in bpy.ops.object.mode_set.get_rna_type().properties['mode'].enum_items]
bpy.ops.object.mode_set(mode=next(v for v in modes if v=='EDIT'))
def bone(name,head,tail,parent=None,deform=True):
 b=data.edit_bones.new(name);b.head=head;b.tail=tail;b.use_deform=deform
 if parent:b.parent=data.edit_bones[parent]
 return b
bone('root',(0,0,0),(0,0,.20),deform=False)
bone('pelvis',(0,0,.91),(0,0,1.08),'root')
bone('spine',(0,0,1.08),(0,0,1.30),'pelvis')
bone('chest',(0,0,1.30),(0,0,1.50),'spine')
bone('neck',(0,0,1.50),(0,0,1.58),'chest')
bone('head',(0,0,1.58),(0,0,1.82),'neck')
for suffix,s in [('L',1),('R',-1)]:
 def pos(x,y,z):return (s*x,y,z)
 bone('clavicle.'+suffix,pos(.04,0,1.46),pos(.23,0,1.43),'chest')
 bone('upper_arm.'+suffix,pos(.23,0,1.43),pos(.36,-.01,1.23),'clavicle.'+suffix)
 bone('forearm.'+suffix,pos(.36,-.01,1.23),pos(.51,-.025,1.04),'upper_arm.'+suffix)
 bone('hand.'+suffix,pos(.51,-.025,1.04),pos(.57,-.035,.88),'forearm.'+suffix)
 bone('thigh.'+suffix,pos(.16,0,.95),pos(.19,-.015,.55),'pelvis')
 bone('shin.'+suffix,pos(.19,-.015,.55),pos(.21,0,.16),'thigh.'+suffix)
 bone('foot.'+suffix,pos(.21,0,.16),pos(.21,-.16,.07),'shin.'+suffix)
bpy.ops.object.mode_set(mode=next(v for v in modes if v=='OBJECT'))
rig['rig_stage']='Joint placement draft - not yet bound or physics enabled'
rig['intended_use']='Runtime ragdoll drives deform bones; helmet and backpack require rigid weighting'
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
bpy.ops.object.mode_set(mode=next(v for v in modes if v=='EDIT'))
print('Created 20-bone joint-placement draft. No weights or physics yet.')
