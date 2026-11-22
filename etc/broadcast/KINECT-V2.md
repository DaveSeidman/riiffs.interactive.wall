# Kinect v2 input assessment

The existing Blush/Pulse renderer accepts fused world skeletons. Kinect v2 would replace the capture and pose source upstream of that interface. The Chrome → OBS → NDI route can remain the same.

## Proposed integration

A native bridge would read Kinect skeletons, attach camera serial numbers, frame timestamps and local body IDs, then send them over WebSocket to the tracker. Convert the SDK coordinate system to this project's X-right, Y-down, Z-forward metres, apply each camera's placement, and reuse world fusion and identity tracking.

Map the Kinect body joints into the existing 33-slot representation. Supply shoulders, elbows, wrists, hips, knees, ankles and head to the slots consumed by the effects. Represent unavailable joints with null positions and zero confidence. Convert tracking confidence explicitly and map SDK IDs to safe numeric IDs. The experience currently validates exactly 33 joint entries. Native SDK body tracking would supply the skeletons directly.

The bench would need a Kinect source adapter, connection UI, confidence handling and calibration inputs. Existing guided calibration assumes normalized image landmarks and ZED camera objects, so it needs adaptation too. A WebSocket receiver is required because BroadcastChannel only connects pages in the same browser origin.

## Host options

Microsoft's Kinect v2 SDK provides body tracking on Windows. Start with one Kinect and a compatible Windows PC, then feed skeletons to the Mac over the LAN. The official requirements include a dedicated USB 3.0 controller and powered sensor cabling. Validate the particular Windows version and USB controller before planning the installation. [Microsoft SDK requirements](https://www.microsoft.com/en-gb/download/details.aspx?id=44561)

libfreenect2 provides RGB, depth and RGB/depth registration across platforms, including macOS. Using it on the Mac would require a separate pose estimator such as the current MediaPipe pipeline, lifting landmarks through registered Kinect depth. Apple Silicon compatibility needs a hardware test. Its multi-device documentation calls for substantial USB bandwidth and separate controllers. [OpenKinect libfreenect2](https://github.com/OpenKinect/libfreenect2)

## Installation implications

The existing room spans roughly 43 ft by 20 ft. Test usable full-body depth at the intended distances before selecting mounts. Camera overlap, occlusion and depth validity must be measured with both sensors running. For multiple sensors, preserve timestamps and camera-local IDs and calibrate their poses into one room coordinate system. A shared center capture determines translation only. Add shared positions spread through the overlap to constrain yaw and assess residual errors.

The official Kinect v2 SDK supports one sensor per computer. Two SDK-based tracking feeds therefore require separate Windows hosts, or a different capture/body-tracking stack. Dedicated USB controllers alone do not remove this SDK limit. [Microsoft Kinect developer Q&A](https://download.microsoft.com/download/E/B/A/EBA3E93D-E02C-436A-AA9B-698129E521AF/Public%20QA%20Log%20Programming%20the%20Kinect%20for%20Windows%20v2%20Jump%20Start.pdf)

Recommended first prototype is one Windows SDK bridge feeding the existing live skeleton format, followed by a second sensor after validating single-camera tracking. Kinect hardware, SDK compatibility, multi-camera capture and coverage have not been tested here. This document records a design proposal, not an implemented Kinect source.
