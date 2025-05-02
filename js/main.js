// -------------- LIBRARIES --------------
import * as THREE from 'https://cdn.skypack.dev/three@0.129.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { keyState } from './controls.js';

// ------------------ SCENE ------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0D0B1C);   // Dark blue background (night sky)

// ------------------ CAMERA ------------------
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// ------------------ LIGHTS ------------------
const light = new THREE.DirectionalLight(0xffffff, .7); // Light Color & Intensity
light.position.set(1.5, 1, 1); // Light position
scene.add(light);

// ------------------ RENDERER ------------------
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ---------------- ORBIT CONTROLS ----------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Enables SMOOTH orbit

// -------------- HANDLE WINDOW RESIZE --------------
window.addEventListener('resize', () => { // Allows user to resize window
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}); 

// -------------- PHYSICS (CANNON) --------------
const world = new CANNON.World(); // Creates physics world with gravity
world.gravity.set(0, -9.82, 0); // Sets gravitational pull
// Creates infinite road (ground) collider using Cannon Plane.
const groundMaterial = new CANNON.Material();
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({
  mass: 0, // Static Body
  material: groundMaterial,
});
groundBody.addShape(groundShape);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Flattens ground at y = 0
world.addBody(groundBody); // Creates invisible collidable plane on the ground




/** ======================= LOAD 3D CAR MODELS ========================
 * The following segment of code retrieves the 3D models (glb) in the
 * assets>models folder, and inserts them into the scene. The retrieved
 * models consist of the Player Car and the NPC cars. The car's speed,
 * physics, tires, and lights are defined in this segment.
 *///==================================================================

let player_car; // Declares Player's Car
let carBody;  // Car's collision body
let carOffsetY = 0; // Offset computed from the model's bounding box for proper alignment
let tires = []; // Array to store tire meshes

// Speed values based on Unit per Second
let currentSpeed = 40;         // Initial Speed
const maxSpeed = 80;           // Maximum Speed
const accelerationRate = 15;   // Speed increment per sec when accelerating
const brakeDecelerationRate = 25; // Speed decrement per sec when braking

const loader = new GLTFLoader();
loader.load(
  './assets/models/prototype_car.glb', // Model Path
  function (gltf) {
    player_car = gltf.scene;
    scene.add(player_car);

    // Compute the model's bounding box so its bottom aligns at y = 0.
    const bbox = new THREE.Box3().setFromObject(player_car);
    carOffsetY = -bbox.min.y;
    player_car.position.set(0, carOffsetY, 0);

    // Approximate the car with a box collider of half-extents (0.5, 0.25, 1)
    // which gives a full size of (1, 0.5, 2). The car's bottom touches y = 0 when its center is at y = 0.25.
    const carShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 1));
    carBody = new CANNON.Body({
      mass: 150,  // Car mass
    });
    carBody.addShape(carShape);

    // Position the car above the road to allow gravity to pull it down initially.
    carBody.position.set(0, 0.5, 0);
    carBody.fixedRotation = true;
    carBody.updateMassProperties();
    world.addBody(carBody);

    // Retrieve each Tire mesh from Car model hierarchy.
    const frontLeftTire = player_car.getObjectByName("front_l_tire");
    const frontRightTire = player_car.getObjectByName("front_r_tire");
    const backLeftTire = player_car.getObjectByName("back_l_tire");
    const backRightTire = player_car.getObjectByName("back_r_tire");
    tires = [frontLeftTire, frontRightTire, backLeftTire, backRightTire];

    // Retrieve each taillight point light from Car model hierarchy
    const taillightNames = ["taillight_r2", "taillight_l1", "taillight_l2", "taillight_r1"];
    taillightNames.forEach(name => {
      const tailLight = player_car.getObjectByName(name);
      if (tailLight) {
        tailLight.userData.baseIntensity = tailLight.intensity; // Stores light intensity value
      }
    });
  },
  undefined,
  function (error) { // Catches missing model error
    console.error('Model missing:', error);
  }
);




/** ===================== CREATES INFINITE HIGHWAY =====================
 *  This segment of code is responsible for generating the road, highway
 *  barriers, and collidable invisible walls. These models are generated
 *  according player's Z position and are recycled for optimization.
 *///==================================================================

const laneCount = 4;
const laneWidth = 3;
const roadTotalWidth = laneCount * laneWidth;
const segmentLength = 50; // 50 units long
const numSegments = 20;
const roadSegments = [];
let globalBarrierModel = null;

// FUNCTION - Attaches 3D Road Barrier on both sides of the Road Segment
function addBarriersToSegment(segment) {
  if (!globalBarrierModel) return;
  const barrierOffset = 1; // Adjusted to stick to side of road

  // LEFT - 3D Model road barrier
  const leftBarrier = globalBarrierModel.clone();
  leftBarrier.rotation.set(0, Math.PI / 2, 0);
  leftBarrier.position.set(-roadTotalWidth / 2 - barrierOffset, 0, 0);
  segment.add(leftBarrier);

  // RIGHT - 3D Model road barrier
  const rightBarrier = globalBarrierModel.clone();
  rightBarrier.rotation.set(0, -Math.PI / 2, 0);
  rightBarrier.position.set(roadTotalWidth / 2 + barrierOffset, 0, 0);
  segment.add(rightBarrier);

  segment.userData.hasBarriers = true;
}

// FUNCTION - Attaches Invisible Collidable Walls to Road Edges
function addCollidableWallsToSegment(segment) {
  const wallThickness = 0.5;
  const wallHeight = 2;
  const margin = -.95; // Offset from the road edge

  // Use segment's current z position
  const zPos = segment.position.z;
  const halfExtents = new CANNON.Vec3(wallThickness / 2, wallHeight / 2, segmentLength / 2);

  // Checks if collidable wall body has already been attached to the wall segment
  if (!segment.userData.wallBodies) {
    // Create new collidable wall bodies.
    const leftWallBody = new CANNON.Body({ mass: 0 });
    leftWallBody.addShape(new CANNON.Box(halfExtents));
    leftWallBody.position.set(-roadTotalWidth / 2 - wallThickness / 2 - margin, wallHeight / 2, zPos);
    world.addBody(leftWallBody);
    const rightWallBody = new CANNON.Body({ mass: 0 });
    rightWallBody.addShape(new CANNON.Box(halfExtents));
    rightWallBody.position.set(roadTotalWidth / 2 + wallThickness / 2 + margin, wallHeight / 2, zPos);
    world.addBody(rightWallBody);
    segment.userData.wallBodies = [leftWallBody, rightWallBody];
  } else {
    // Update their positions to follow the segment
    const [leftWallBody, rightWallBody] = segment.userData.wallBodies;
    leftWallBody.position.set(-roadTotalWidth / 2 - wallThickness / 2 - margin, wallHeight / 2, zPos);
    rightWallBody.position.set(roadTotalWidth / 2 + wallThickness / 2 + margin, wallHeight / 2, zPos);
  }
  segment.userData.hasCollidableWalls = true;
}

// FUNCTION - Creates road segment containing asphalt, dashed lines, side lines, visual 3d barrier & invisible collidable barrier
function createRoadSegment(zPosition) {
  const roadSegmentGroup = new THREE.Group();

  // ------------ ASPHALT BASE ------------
  const asphaltGeometry = new THREE.PlaneGeometry(roadTotalWidth, segmentLength);
  const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const asphaltMesh = new THREE.Mesh(asphaltGeometry, asphaltMaterial);
  asphaltMesh.rotation.x = -Math.PI / 2;
  roadSegmentGroup.add(asphaltMesh);

  // ------------ DASHED LINES ------------
  const dashThickness = 0.15;
  const dashLength = 1;
  const gapLength = 4;
  for (let i = 1; i < laneCount; i++) {
    const xPos = -roadTotalWidth / 2 + i * laneWidth;
    const dashGroup = new THREE.Group();
    for (let z = -segmentLength / 2; z < segmentLength / 2; z += dashLength + gapLength) {
      const dashGeometry = new THREE.PlaneGeometry(dashThickness, dashLength);
      const dashMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const dashMesh = new THREE.Mesh(dashGeometry, dashMaterial);
      dashMesh.rotation.x = -Math.PI / 2;
      dashMesh.position.set(xPos, 0.01, z + dashLength / 2);
      dashGroup.add(dashMesh);
    }
    roadSegmentGroup.add(dashGroup);
  }

  // -------------- SIDE LINES --------------
  const sideLineGeometry = new THREE.PlaneGeometry(dashThickness, segmentLength);
  const sideLineMaterial = new THREE.MeshStandardMaterial({ color: 0xd2d2d2 });
  const leftSideLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  leftSideLine.rotation.x = -Math.PI / 2;
  leftSideLine.position.set(-roadTotalWidth / 2 + dashThickness / 2, 0.02, 0);
  roadSegmentGroup.add(leftSideLine)
  const rightSideLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  rightSideLine.rotation.x = -Math.PI / 2;
  rightSideLine.position.set(roadTotalWidth / 2 - dashThickness / 2, 0.02, 0);
  roadSegmentGroup.add(rightSideLine);

  // ----------- ADD VISUAL BARRIERS -----------
  if (globalBarrierModel) {
    addBarriersToSegment(roadSegmentGroup);
  }

  // IMPORTANT: Set the segment's position first.
  roadSegmentGroup.position.set(0, 0, zPosition);

  // ------------ ADD INVISIBLE WALLS ------------
  addCollidableWallsToSegment(roadSegmentGroup);

  scene.add(roadSegmentGroup);
  return roadSegmentGroup;
}

// FUNCTION - Retrieves Highway Barrier 3D GLB model and attaches to all road segments
function loadRoadBarriers() {
  const barrierLoader = new GLTFLoader();
  barrierLoader.load(
    './assets/models/road_barrier.glb', // Adjust the path as needed.
    function (gltf) {
      globalBarrierModel = gltf.scene;
      globalBarrierModel.scale.set(1, 0.5, 1);
      roadSegments.forEach(segment => {
        if (!segment.userData.hasBarriers) {
          addBarriersToSegment(segment);
        }
      });
    },
    undefined,
    function (error) {
      console.error('Error loading road barrier model:', error);
    }
  );
}

// FUNCTION - Recyles road segments based on player's position. Replaces each recyled road segment (INFINITE)
function updateRoad(playerPositionZ) {
  roadSegments.forEach(segment => {
    if (segment.position.z > playerPositionZ + segmentLength) {
      segment.position.z -= numSegments * segmentLength;
      // Re-add or update visual barriers if needed.
      if (globalBarrierModel && !segment.userData.hasBarriers) {
        addBarriersToSegment(segment);
      }
      // Update collidable walls to match the segment's new position.
      addCollidableWallsToSegment(segment);
    }
  });
}

// ------------ INITIALIZATION ------------
const carStartZ = 0; // Player's starting Z position
for (let i = 0; i < numSegments; i++) { // Pushes road segments along -Z axis
  roadSegments.push(createRoadSegment(carStartZ - i * segmentLength));
}
// Load the road barriers (this attaches visual barrier pairs to all existing segments).
loadRoadBarriers();




/** =========================== ENVIRONMENT ===========================
 *  This segment of code is dedicated to generating the environment that
 *  lies outside of the highway barrier walls. Mainly: skyscraper models
 *  are retrieved and randomly generated in the environment and models
 *  are recycled similar to the rest of the continuous highway segments.
 *///==================================================================
const skyscraperModels = [];
const skyScraperLoader = new GLTFLoader();

Promise.all([
  skyScraperLoader.loadAsync('./assets/models/SkyScraperM1.glb'),
  skyScraperLoader.loadAsync('./assets/models/SkyScraperM2.glb'),
  skyScraperLoader.loadAsync('./assets/models/SkyScraperM3.glb')
]).then((gltfs) => {
  gltfs.forEach(gltf => {
    skyscraperModels.push(gltf.scene);
  });

  spawnSkyscrapers();
}).catch(error => {
  console.error('Error loading skyscrapers:', error);
});

// Array to keep track of the instantiated skyscraper meshes
const spawnedSkyscrapers = [];

function spawnSkyscrapers() {
  // Increased spacing along the Z axis and fewer rows
  const spacing = 25;       // Base spacing for each row
  const numOfRows = 20;     // Fewer rows per update
  const roadCenterZ = 0;
  const baseScale = 2;      // Base scale value for width and depth
  // List of available colors (red, blue, green) for window emission.
  //const windowColors = [0xEFE6B6, 0xBCD4EF, 0xD3B6EF, 0xF6A8A8, 0xEDBB99];
  const windowColors = [0xE04A4A, 0xCF9F65, 0xECE172, 0x7A9AC5, 0xB07AC5];

  for (let i = 0; i < numOfRows; i++) {
    // Pick random models for the left and right skyscrapers
    const randomModelL = skyscraperModels[Math.floor(Math.random() * skyscraperModels.length)].clone();
    const randomModelR = skyscraperModels[Math.floor(Math.random() * skyscraperModels.length)].clone();

    // Slight random offset on the z axis to avoid perfect alignment.
    const zRandomOffset = (Math.random() - 0.5) * 3; // Approximately -1.5 to +1.5

    // LEFT BUILDING:
    const randomOffsetLeft = Math.random() * 5;   // Random value between 0 and 5, pushing further to the left
    const xPosLeft = -40 - randomOffsetLeft;      // Always further left, never toward the road

    // RIGHT BUILDING:
    const randomOffsetRight = Math.random() * 10;  // Random value between 0 and 10, pushing further to the right
    const xPosRight = 40 + randomOffsetRight;      // Always further right

    randomModelL.position.set(xPosLeft, 0, roadCenterZ - i * spacing + zRandomOffset);
    randomModelR.position.set(xPosRight, 0, roadCenterZ - i * spacing + zRandomOffset);

    // Random Y scaling for varying height.
    const randomScaleYLeft = baseScale + Math.random();  // Y between baseScale and baseScale + 1
    const randomScaleYRight = baseScale + Math.random(); 

    // Scale X axis to make the building wider based on its offset.
    // The farther from the road, the larger the X scale.
    const scaleXLeft = baseScale * (1 + randomOffsetLeft * 0.1);  // A factor of 1 + (randomOffsetLeft * 0.1)
    const scaleXRight = baseScale * (1 + randomOffsetRight * 0.1);

    // Use the baseScale for Z (depth) unchanged.
    randomModelL.scale.set(scaleXLeft, randomScaleYLeft, baseScale);
    randomModelR.scale.set(scaleXRight, randomScaleYRight, baseScale);

    // NEW: Apply random emission color to the building windows.
    // For the left building:
    const randomColorL = windowColors[Math.floor(Math.random() * windowColors.length)];
    const windowsL = randomModelL.getObjectByName("building_windows");
    if (windowsL && windowsL.material) {
      windowsL.material = windowsL.material.clone(); // Clone to avoid affecting shared materials.
      windowsL.material.emissive = new THREE.Color(randomColorL);
    }
    // For the right building:
    const randomColorR = windowColors[Math.floor(Math.random() * windowColors.length)];
    const windowsR = randomModelR.getObjectByName("building_windows");
    if (windowsR && windowsR.material) {
      windowsR.material = windowsR.material.clone();
      windowsR.material.emissive = new THREE.Color(randomColorR);
    }

    scene.add(randomModelL);
    spawnedSkyscrapers.push(randomModelL);

    scene.add(randomModelR);
    spawnedSkyscrapers.push(randomModelR);
  }
}

function updateSkyscrapers(playerZ) {
  const recycleThreshold = 50;
  const spacing = 25;
  const numOfRows = 20;
  // Total length of the skyscraper arrangement
  const totalLength = spacing * numOfRows;
  
  spawnedSkyscrapers.forEach(skyscraper => {
    if (skyscraper.position.z > playerZ + recycleThreshold) {
      skyscraper.position.z -= totalLength;
    }
  });
}




/** =========================== ANIMATIONS ==========================
 *  This segment implements the main animation loop for the game.
 *  It updates the physics simulation, processes user inputs to control
 *  acceleration, braking, and turning, and synchronizes visual elements
 *  such as car orientation, tire rotation, tail light intensity, and
 *  camera positioning with the underlying physics.
 *///==================================================================


 const clock = new THREE.Clock();
 let brakingActive = false; // Global variable to track braking state
 
 // FUNCTION - Updates taillight light itensities based on braking status
 function updateTailLights(isBraking) {
   const taillightNames = ["taillight_r2", "taillight_l1", "taillight_l2", "taillight_r1"];
   taillightNames.forEach(name => {
     // Retrieve tail light from player_car; if not found, try scene.
     let tailLight = null;
     if (player_car) {
       tailLight = player_car.getObjectByName(name);
     }
     if (!tailLight) {
       tailLight = scene.getObjectByName(name);
     }
     if (tailLight && tailLight.userData.baseIntensity !== undefined) {
       tailLight.intensity = isBraking
         ? tailLight.userData.baseIntensity * 1.5  // Increases the wattage when braking
         : tailLight.userData.baseIntensity;       // Resets to base wattage
     }
   });
 }
 
 // Global turning variables (persist between frames)
 let turnAngularVelocity = 0;
 const maxTurnSpeed = 2.5;       // Maximum angular speed (radians per second)
 const turnAcceleration = 2.5;   // Angular acceleration (radians per second^2)
 const turnDamping = 0.9;        // Damping factor when no turn inputs are active
 
 function animate() {
   requestAnimationFrame(animate);
   controls.update();
   const delta = clock.getDelta();
   world.step(1 / 60, delta, 3);
   updateSkyscrapers(carBody.position.z);
 
 
   if (player_car && carBody) {
     // Update car speed based on controls.
     if (keyState.forward) {
      // Modified: Strongly reduce acceleration when turning to avoid buildup of excessive speed.
      // Previously, effectiveAcceleration was multiplied by 0.5; now we use 0.3 to further limit currentSpeed.
      let effectiveAcceleration = accelerationRate;
      if (keyState.left || keyState.right) {
        effectiveAcceleration *= 0.1;
      }
      currentSpeed += effectiveAcceleration * delta;
      if (currentSpeed > maxSpeed) currentSpeed = maxSpeed;
      if (brakingActive) {
        updateTailLights(false);
        brakingActive = false;
      }
    } else if (keyState.brake) {
      currentSpeed -= brakeDecelerationRate * delta;
      if (currentSpeed < 0) currentSpeed = 0;
      if (!brakingActive) {
        updateTailLights(true);
        brakingActive = true;
      }
    } else {
      currentSpeed -= (brakeDecelerationRate * delta) / 5;
      if (currentSpeed < 0) currentSpeed = 0;
      if (brakingActive) {
        updateTailLights(false);
        brakingActive = false;
      }
    }
    
 
     // --- Smoother Turning Implementation ---
     // Increase or decrease turnAngularVelocity based on left/right inputs.
     if (keyState.left) {
       turnAngularVelocity += turnAcceleration * delta;
       if (turnAngularVelocity > maxTurnSpeed) turnAngularVelocity = maxTurnSpeed;
     } else if (keyState.right) {
       turnAngularVelocity -= turnAcceleration * delta;
       if (turnAngularVelocity < -maxTurnSpeed) turnAngularVelocity = -maxTurnSpeed;
     } else {
       // When no turn key is pressed, apply damping.
       turnAngularVelocity *= turnDamping;
       if (Math.abs(turnAngularVelocity) < 0.001) turnAngularVelocity = 0;
     }
 
     // Compute the small incremental turn angle for this frame.
     const turnAngle = turnAngularVelocity * delta;
     const turnQuaternion = new THREE.Quaternion();
     turnQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turnAngle);
     // Apply the rotation increment to the car's orientation.
     player_car.quaternion.multiplyQuaternions(turnQuaternion, player_car.quaternion);
     // Copy the updated orientation to the physics body.
     carBody.quaternion.copy(player_car.quaternion);
 
     // --- Update the Car's Forward Velocity ---
     const forwardVector = new THREE.Vector3(0, 0, -1);
     forwardVector.applyQuaternion(player_car.quaternion).normalize();
 
     // If turning - reduce speed
     let effectiveSpeed = currentSpeed;
     if (keyState.left || keyState.right) {
       // Determine a reduction factor based on how strongly the car is turning.
       const reductionFactor = 0.5 * Math.min(Math.abs(turnAngularVelocity) / maxTurnSpeed, 1);
       effectiveSpeed = currentSpeed * (1 - reductionFactor);
     }
     // Set the physics body's velocity in the direction the car is facing.
     carBody.velocity.set(forwardVector.x * effectiveSpeed, carBody.velocity.y, forwardVector.z * effectiveSpeed);
 
     // Compute and set the visual offset for the car model.
     const drawOffset = carOffsetY - 0.25;
     player_car.position.copy(carBody.position).add(new THREE.Vector3(0, drawOffset, 0));
 
     // Update visual infinite road
     updateRoad(carBody.position.z);
 
     // Animate Tire rotation based on forward movement
     const tireRadius = 0.3;
     const angularDelta = (currentSpeed * delta) / tireRadius;
     tires.forEach(tire => {
       if (tire) {
         tire.rotation.x -= angularDelta / 3;
       }
     });
 
     // --- Updated Camera Positioning (Directly Behind the Car with Lag Only on Turning Axis) ---
     const cameraDistanceBehind = -2.5; 
     const cameraHeight = 2.0;          
     const carDirection = new THREE.Vector3();
     player_car.getWorldDirection(carDirection);
 
     // Place the camera behind the car (opposite to its forward vector)
     const cameraOffset = carDirection.clone().negate().multiplyScalar(cameraDistanceBehind);
     const desiredCameraPos = player_car.position.clone().add(cameraOffset);
     desiredCameraPos.y += cameraHeight;
 
     // Apply smoothing (lag) on the X (and Y, if desired) axes, but snap the Z coordinate instantly.
     const cameraSmoothFactor = 0.1;
     camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredCameraPos.x, cameraSmoothFactor);
     camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredCameraPos.y, cameraSmoothFactor);
     camera.position.z = desiredCameraPos.z;
 
     const adjustedPosition = player_car.position.clone();
     adjustedPosition.y += 2.25;
     camera.lookAt(adjustedPosition);
   }
   renderer.render(scene, camera);
 }
 animate();
 








/** 
// ========= TIRE DUST PARTICLES SETUP ========= 
const particleTexture = new THREE.TextureLoader().load('assets/textures/CarSmokeDust.png');

const dustMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 5,
  map: particleTexture,
  transparent: true,
  depthWrite: false,
  opacity: 1
});

const particleGeometry = new THREE.BufferGeometry();
const particleCount = 100;
const positions = new Float32Array(particleCount * 3);

for (let i = 0; i < particleCount * 3; i++) {
  positions[i] = 0;
}

particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const dustParticles = new THREE.Points(particleGeometry, dustMaterial);
scene.add(dustParticles);
console.log('Loaded texture: ', particleTexture);
*/