// -------------- LIBRARIES --------------
import * as THREE from 'https://cdn.skypack.dev/three@0.129.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { keyState } from './controls.js';


// ------------------ SCENE ------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070610); // Scene Background Color


// ------------------ CAMERA ------------------
const camera = new THREE.PerspectiveCamera( // Defines Camera
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// INTRO camera animation - global variables
let introCameraAnimation = true;  // Set to True at game start
let introTimer = 0;
const INTRO_DURATION = 2;         // Duration of the Intro rotation

const cameraFrontDistance = 2;    // Distance in front of the car
const cameraBehindDistance = 2.5; // Distance behind the car
const cameraInitialHeight = 1.2;  // Initial camera height (starts lower)
const cameraFinalHeight = 2.0;    // Camera height at end of intro


// ------------------ LIGHTS ------------------
const light = new THREE.DirectionalLight(0xffffff, .6); // Light Color & Intensity
light.position.set(1.5, 1, 1);                          // Light Position
scene.add(light);                                       // Defines scene lighting
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
world.gravity.set(0, -9.82, 0);   // Sets gravitational pull

// Creates infinite road (ground) collider using Cannon Plane.
const groundMaterial = new CANNON.Material();
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({
  mass: 0, // Static Body
  material: groundMaterial,
});
groundBody.addShape(groundShape);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Flattens ground at y = 0
world.addBody(groundBody); // Adds grounded invisible collidable plane to the scene


// ---------------- HUD ELEMENTS ----------------
const speedDisplay = document.getElementById('speedDisplay');
const brakeStatus = document.getElementById('brakeStatus');
const scoreDisplay = document.getElementById('scoreDisplay');


// ---------------- GLOBAL VARIABLES ----------------
// Player car values
let player_car;                         // Declares Player's Car
let carBody;                            // Declares Car's collision body
let carOffsetY = 0;                     // Offset computed from model's bounding box (for alignment)
let tires = [];                         // Array to store tire meshes

// Speed values based on Unit per Second
let currentSpeed = 40;                  // Initial Speed
const maxSpeed = 100;                   // Maximum Speed
const accelerationRate = 15;            // Speed increment per sec when accelerating
const brakeDecelerationRate = 25;       // Speed decrement per sec when braking

// Road values
const laneCount = 4;                    // Defines number of Lanes
const laneWidth = 3;                    // Defines width of each Lane
const roadTotalWidth = laneCount * laneWidth;
const segmentLength = 50;               // Defines road segment length (units)
const numSegments = 20;                 // Defines number of road segments at a time
const roadSegments = [];                // Array for road segments
let globalNPCCarModel = null;           // NPC car model
let globalBarrierModel = null;          // Road barrier model
let globalLightBarrierModel = null;     // Road light barrier model
let globalTestLightModel = null;        // Street light spotlight model to be placed in middle
let scoreValue = 0;


/** ========================== 3D CAR MODELS ==========================
 * The following segment of code retrieves the 3D models (glb) in the
 * assets->models folder, and inserts them into the scene. The retrieved
 * models consist of the Player Car and the NPC cars. The car's speed,
 * physics, tires, and lights are defined in this segment.
 *///==================================================================

// ==================== LOAD PLAYER CAR MODEL ====================
const loader = new GLTFLoader();
loader.load(
  './assets/models/prototype_car.glb', // Player Car Model Path
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
      mass: 150,  // Player Car mass
    });
    carBody.addShape(carShape);

    // Position the car above the road to allow gravity to pull it down initially.
    carBody.position.set(0, 0.5, 0);
    carBody.fixedRotation = true;
    carBody.updateMassProperties();
    world.addBody(carBody);

    // Save the physics body reference for later use.
    player_car.userData.physicsBody = carBody;

    // Retrieve each Tire mesh from Car model hierarchy
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
        tailLight.userData.baseIntensity = tailLight.intensity; // Stores light intensity value.
      }
    });
  },
  undefined,
  function (error) { // Catches missing model error.
    console.error('Model missing:', error);
  }
);

// ==================== NPC CAR SPAWN/DE-SPAWN SYSTEM ====================
function updateNPCCars(playerPositionZ, delta) {

  const npcSpeed = 30; // NPC Speed (units per second)
  // Boundaries relative to the player's z position
  const activeRearZ = playerPositionZ + 100;
  const activeFrontZ = playerPositionZ - 1100;

  roadSegments.forEach(segment => {
    if (segment.userData.npcCar) {
      const npc = segment.userData.npcCar;

      // Update NPC's global z position
      npc.userData.globalZ -= npcSpeed * delta;

      // Recalculate local z-position relative to the segment
      npc.position.z = npc.userData.globalZ - segment.position.z;

      // Update physics body's position
      if (npc.userData.physicsBody) {
        npc.userData.physicsBody.position.set(
          npc.position.x, // x remains unchanged.
          0.5,
          npc.userData.globalZ
        );
      }

      // Tire Rotation
      // Obtains the tire meshes from the NPC car model
      if (npc.userData.npcTires === undefined) {
        npc.userData.npcTires = [
          npc.getObjectByName("front_l_tire"),
          npc.getObjectByName("front_r_tire"),
          npc.getObjectByName("back_l_tire"),
          npc.getObjectByName("back_r_tire")
        ];
      }

      // Define tire radius
      const tireRadius = 0.3;

      // Calculate the angular displacement (in radians)
      const angularDelta = (npcSpeed * delta) / tireRadius;

      // Loop over each tire group and rotate each child
      npc.userData.npcTires.forEach(tireGroup => {
        if (tireGroup && tireGroup.children && tireGroup.children.length > 0) {
          tireGroup.children.forEach(child => {
            child.rotation.x -= angularDelta;
          });
        }
      });

      // --- Despawn Check ---
      if (npc.userData.globalZ > activeRearZ || npc.userData.globalZ < activeFrontZ) {
        if (npc.userData.physicsBody) {
          world.removeBody(npc.userData.physicsBody);
        }
        segment.remove(npc);
        delete segment.userData.npcCar;
      }
    }
  });
}
const carStartZ = 0;  // Player's initial Z position


// ==================== SETS SPAWNED NPC CAR ====================
function spawnNPCCar(segment) {
  if (!globalNPCCarModel) {
    segment.userData.needNPCCar = true;
    return;
  }
  delete segment.userData.needNPCCar;

  // Clone the NPC car model as before.
  const npcCar = globalNPCCarModel.clone();
  npcCar.rotation.y = -Math.PI;
  npcCar.scale.set(1, 1, 1);

  // Change the car's color.
  const mainFrame = npcCar.getObjectByName("main_frame");
  if (mainFrame) {

    // Array of possible NPC car colors
    const colors = [0xCA1818, 0x254EA3, 0xE8B221, 0xD5D5D5];

    const chosenColor = colors[Math.floor(Math.random() * colors.length)];
    mainFrame.traverse(child => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          const originalMat = child.material[0];
          child.material[0] = originalMat.clone();
          child.material[0].color.setHex(chosenColor);
          child.material[0].needsUpdate = true;
        } else {
          child.material = child.material.clone();
          child.material.color.setHex(chosenColor);
          child.material.needsUpdate = true;
        }
      }
    });
  } else {
    console.warn("main_frame not found in NPC car model.");
  }

  // Determine lane and random z-offset as before.
  const laneIndex = Math.floor(Math.random() * laneCount);
  const laneX = -roadTotalWidth / 2 + laneWidth / 2 + laneIndex * laneWidth;
  const offsetZ = THREE.MathUtils.randFloat(-segmentLength / 4, segmentLength / 4);
  npcCar.position.set(laneX, 0.36, offsetZ);

  // Compute a "global" z-position by adding in the segment's z offset.
  npcCar.userData.globalZ = segment.position.z + npcCar.position.z;
  segment.add(npcCar);
  segment.userData.npcCar = npcCar;

  // Attach Collision Body
  // Approximate car with a box shape (half-extents match player car approximations)
  const halfExtents = new CANNON.Vec3(0.55, 1, 2.2);     // Adjusted half-extents for width/height/depth
  const collisionShape = new CANNON.Box(halfExtents);
  const collisionBody = new CANNON.Body({ mass: 500 });  // Mass remains as set.
  const offset = new CANNON.Vec3(0.15, 0, 0.8);          // Offsets the shape so that right side is fixed
  collisionBody.addShape(collisionShape, offset);

  // Set the physics body's position to match the computed globalZ
  collisionBody.position.set(laneX, 0.5, npcCar.userData.globalZ);

  // Set its orientation if needed
  collisionBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, .25, 0), -Math.PI);

  // Mark this body as belonging to an NPC so that collision tests can distinguish it
  collisionBody.isNPC = true;

  // Add the body to the physics world
  world.addBody(collisionBody);

  // Save the collision body reference for later updates
  npcCar.userData.physicsBody = collisionBody;

  player_car.userData.physicsBody.addEventListener("collide", function (e) {
    // Only trigger if the other body is flagged as an NPC
    if (e.body && e.body.isNPC) {
      triggerGameOver();
    }
  });
  player_car.userData.physicsBody.addEventListener("collide", function (event) {
    // event.body is the object the player's body collided with.
    if (event.body && event.body.isWall) {
      triggerGameOver();
    }
  });
}


// ==================== LOAD NPC CAR MODEL ====================
function loadNPCCarModel() {
  const loader = new GLTFLoader();
  loader.load(
    './assets/models/npc_car.glb',
    function (gltf) {
      globalNPCCarModel = gltf.scene;
      console.log('NPC car model loaded.');
      roadSegments.forEach(segment => {
        if (segment.userData.needNPCCar) {
          spawnNPCCar(segment);
        }
      });
    },
    undefined,
    function (error) {
      console.error('Error loading npc_car model:', error);
    }
  );
}




/** ===================== CREATES INFINITE HIGHWAY =====================
 *  This segment of code is responsible for generating the road, highway
 *  barriers, and collidable invisible walls. These models are generated
 *  according player's Z position and are recycled for optimization.
 *///==================================================================


// ==================== LOAD BASE BARRIER MODEL ====================
function loadRoadBarriers() {
  const barrierLoader = new GLTFLoader();
  barrierLoader.load(
    './assets/models/road_barrier.glb',
    function (gltf) {
      globalBarrierModel = gltf.scene;
      globalBarrierModel.scale.set(1, 1, 1);
      roadSegments.forEach(segment => {
        // For segments that haven't been assigned barriers and are not flagged for a light barrier,
        // use the regular barrier model.
        if (!segment.userData.hasBarriers && !segment.userData.useLightBarrier) {
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


// ==================== LOAD LIGHT BARRIER MODEL ====================
function loadRoadLightBarrier() {
  const barrierLoader = new GLTFLoader();
  barrierLoader.load(
    './assets/models/road_light_barrier.glb',
    function (gltf) {
      globalLightBarrierModel = gltf.scene;
      globalLightBarrierModel.scale.set(1, 1, 1);
      // Simply log load success.
      console.log("Road light barrier model loaded.");

      // Update any segments flagged for light barriers.
      roadSegments.forEach(segment => {
        if (segment.userData.useLightBarrier && !segment.userData.hasBarriers) {
          addBarriersToSegment(segment);
        }
      });
    },
    undefined,
    function (error) {
      console.error('Error loading road light barrier model:', error);
    }
  );
}


// ==================== INSERT BARRIER MODELS ====================
// Adds left and right barriers to a segment
function addBarriersToSegment(segment) {
  // Select the appropriate barrier model.
  let barrierModel = globalBarrierModel;
  if (segment.userData.useLightBarrier && globalLightBarrierModel) {
    barrierModel = globalLightBarrierModel;
  }
  if (!barrierModel) return;
  const barrierOffset = 1;  // Adjusted to stick to the side of the road

  // LEFT barrier.
  const leftBarrier = barrierModel.clone();
  leftBarrier.rotation.set(0, Math.PI / 2, 0);
  leftBarrier.position.set(-roadTotalWidth / 2 - barrierOffset, 0, 0);
  segment.add(leftBarrier);

  // RIGHT barrier.
  const rightBarrier = barrierModel.clone();
  rightBarrier.rotation.set(0, -Math.PI / 2, 0);
  rightBarrier.position.set(roadTotalWidth / 2 + barrierOffset, 0, 0);
  segment.add(rightBarrier);

  segment.userData.hasBarriers = true;
}


// ==================== LOAD STREETLIGHT SPOTLIGHT ====================
function loadTestLightModel() {
  const loader = new GLTFLoader();
  loader.load(
    './assets/models/light_test.glb',
    function (gltf) {
      globalTestLightModel = gltf.scene;
      globalTestLightModel.scale.set(1, 1, 1);
      console.log('Test light model loaded.');

      // Once loaded, insert the test light into every segment flagged with useLightBarrier
      roadSegments.forEach(segment => {
        if (segment.userData.useLightBarrier && !segment.userData.hasMiddleTestLight) {
          insertMiddleTestLightIntoSegment(segment);
          segment.userData.hasMiddleTestLight = true;
        }
      });
    },
    undefined,
    function (error) {
      console.error('Error loading test_light model:', error);
    }
  );
}


// ==================== INSERT STREETLIGHT SPOTLIGHT ====================
function insertMiddleTestLightIntoSegment(segment) {
  if (!globalTestLightModel) {
    console.warn("Test light model not loaded yet.");
    return;
  }
  // Create a fresh container group for our rebuilt test light.
  const container = new THREE.Group();
  container.name = "TestLightContainer";
  // Position container locally relative to the segment (centered at x=0, elevated at y=5)
  container.position.set(0, 5, 0);
  // Try to locate a spotlight in the original model
  let originalSpot = null;
  globalTestLightModel.traverse(child => {
    if (child.isSpotLight) {
      originalSpot = child;
    }
  });

  if (originalSpot) {
    console.log("Original spotlight found:", {
      color: originalSpot.color.getHexString(),
      intensity: originalSpot.intensity,
      distance: originalSpot.distance,
      angle: originalSpot.angle,
      penumbra: originalSpot.penumbra,
      decay: originalSpot.decay,
      position: originalSpot.position.toArray()
    });
    // Create a completely new spotlight using the parameters from the original
    const newSpot = new THREE.SpotLight(
      0xF36940,
      originalSpot.intensity,
      originalSpot.distance,
      originalSpot.angle,
      originalSpot.penumbra,
      originalSpot.decay
    );
    newSpot.name = "RebuiltSpotLight";
    newSpot.castShadow = originalSpot.castShadow;
    newSpot.position.copy(originalSpot.position);

    // Create a new target and add it as a child of our container
    const newTarget = new THREE.Object3D();
    newTarget.name = "RebuiltSpotTarget";
    newTarget.position.set(0, -5, 0);
    container.add(newTarget);
    newSpot.target = newTarget;
    newSpot.target.updateMatrixWorld();
    container.add(newSpot);
    console.log("Rebuilt spotlight inserted with target (local):", newTarget.position.toArray());
  } else {
    console.warn("No spotlight found in the original test light model; cloning entire model instead.");
    container.add(globalTestLightModel.clone(true));
  }
  // Clone the original model and remove any spotlights to prevent duplicates
  let accessories = globalTestLightModel.clone(true);
  accessories.traverse(child => {
    if (child.isSpotLight) {
      if (child.parent) child.parent.remove(child);
    }
  });
  container.add(accessories);
  console.log("Insanely revamped test light inserted into segment; container position:", container.position);
  segment.add(container);
}


// ==================== COLLIDABLE WALLS FUNCTION ====================
function addCollidableWallsToSegment(segment) {
  const wallThickness = 0.1;
  const wallHeight = 2;
  const margin = -0.1;  // Offset from the road edge
  const zPos = segment.position.z;
  const halfExtents = new CANNON.Vec3(wallThickness / 2, wallHeight / 2, segmentLength / 2);

  if (!segment.userData.wallBodies) {
    // LEFT Wall
    const leftWallBody = new CANNON.Body({ mass: 0 });
    leftWallBody.addShape(new CANNON.Box(halfExtents));
    leftWallBody.position.set(
      -roadTotalWidth / 2 - wallThickness / 2 - margin,
      wallHeight / 2,
      zPos
    );
    leftWallBody.isWall = true; // <-- Tag the wall
    world.addBody(leftWallBody);

    // RIGHT Wall
    const rightWallBody = new CANNON.Body({ mass: 0 });
    rightWallBody.addShape(new CANNON.Box(halfExtents));
    rightWallBody.position.set(
      roadTotalWidth / 2 + wallThickness / 2 + margin,
      wallHeight / 2,
      zPos
    );
    rightWallBody.isWall = true; 
    world.addBody(rightWallBody);

    segment.userData.wallBodies = [leftWallBody, rightWallBody];
  } else {
    const [leftWallBody, rightWallBody] = segment.userData.wallBodies;
    leftWallBody.position.set(
      -roadTotalWidth / 2 - wallThickness / 2 - margin,
      wallHeight / 2,
      zPos
    );
    rightWallBody.position.set(
      roadTotalWidth / 2 + wallThickness / 2 + margin,
      wallHeight / 2,
      zPos
    );
  }
  segment.userData.hasCollidableWalls = true;
}


// ==================== ROAD SEGMENT CREATION FUNCTION ====================
function createRoadSegment(segmentIndex, zPosition) {
  const roadSegmentGroup = new THREE.Group();

  if (segmentIndex % 5 === 0) {
    roadSegmentGroup.userData.useLightBarrier = true;
  }

  // ASPHALT BASE
  const asphaltGeometry = new THREE.PlaneGeometry(roadTotalWidth, segmentLength);
  const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const asphaltMesh = new THREE.Mesh(asphaltGeometry, asphaltMaterial);
  asphaltMesh.rotation.x = -Math.PI / 2;
  roadSegmentGroup.add(asphaltMesh);

  // DASHED LINES
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

  // SIDE LINES
  const sideLineGeometry = new THREE.PlaneGeometry(dashThickness, segmentLength);
  const sideLineMaterial = new THREE.MeshStandardMaterial({ color: 0xd2d2d2 });
  const leftSideLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  leftSideLine.rotation.x = -Math.PI / 2;
  leftSideLine.position.set(-roadTotalWidth / 2 + dashThickness / 2, 0.02, 0);
  roadSegmentGroup.add(leftSideLine);

  const rightSideLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  rightSideLine.rotation.x = -Math.PI / 2;
  rightSideLine.position.set(roadTotalWidth / 2 - dashThickness / 2, 0.02, 0);
  roadSegmentGroup.add(rightSideLine);

  // ADD BARRIERS. Uses regular barrier or light barrier depending on segment flag
  if (globalBarrierModel || globalLightBarrierModel) {
    addBarriersToSegment(roadSegmentGroup);
  }

  // Set the segment's position.
  roadSegmentGroup.position.set(0, 0, zPosition);

  // ADD COLLIDABLE WALLS.
  addCollidableWallsToSegment(roadSegmentGroup);

  // SPAWN NPC CAR.
  spawnNPCCar(roadSegmentGroup);

  scene.add(roadSegmentGroup);
  return roadSegmentGroup;
}


// ==================== ROAD UPDATE FUNCTION ====================
function updateRoad(playerPositionZ) {
  roadSegments.forEach(segment => {
    // Recycle segments that pass the player's view.
    if (segment.position.z > playerPositionZ + segmentLength) {
      segment.position.z -= numSegments * segmentLength;
      if (!segment.userData.hasBarriers) {
        addBarriersToSegment(segment);
      }
      addCollidableWallsToSegment(segment);

      if (!segment.userData.npcCar && Math.random() < 0.75) {
        spawnNPCCar(segment);
      }
    }
  });
}


// ==================== INITIALIZATION ====================
for (let i = 0; i < numSegments; i++) {
  // Each segment is positioned relative to the player's starting z-position.
  roadSegments.push(createRoadSegment(i, carStartZ - i * segmentLength));
}

// Load external models.
loadRoadBarriers();
loadRoadLightBarrier();
loadNPCCarModel();
loadTestLightModel();




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
  const baseScale = 2;      // Base scale value for width and depth
  const roadCenterZ = 0;

  // List of available colors (red, blue, green) for window emission
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

    // Scale X axis to make the building wider based on its offset
    // The farther from the road, the larger the X scale.
    const scaleXLeft = baseScale * (1 + randomOffsetLeft * 0.1);  // A factor of 1 + (randomOffsetLeft * 0.1)
    const scaleXRight = baseScale * (1 + randomOffsetRight * 0.1);

    // Use the baseScale for Z (depth) unchanged
    randomModelL.scale.set(scaleXLeft, randomScaleYLeft, baseScale);
    randomModelR.scale.set(scaleXRight, randomScaleYRight, baseScale);

    // Apply random emission color to the building windows
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




/** ========================================================
 *  ==================== MISC FUNCTIONS ====================
*///========================================================

const clock = new THREE.Clock();  // Three.js Clock
let brakingActive = false;        // Tracks braking state

// Global turning variables (persist between frames)

let turnAngularVelocity = .1;
const maxTurnSpeed = 1.5;       // Maximum angular speed (radians per second)
const turnAcceleration = 2.5;   // Angular acceleration (radians per second^2)
const turnDamping = 0.9;        // Damping factor when no turn inputs are active


// ------------------- END-GAME UI FUNCTION ------------------
// Triggers the end-game UI overlay that displays final score and offers to retry attempt
function triggerGameOver() {
  gameOver = true;

  // Freeze the car
  carBody.velocity.set(0, 0, 0);
  carBody.angularVelocity.set(0, 0, 0);

  const finalMiles = Math.floor(scoreValue * 0.5);
  document.getElementById('finalScore').textContent = `Score: ${finalMiles}`;

  document.getElementById('gameOverOverlay').style.display = 'flex'; // "WASTED" UI overlay
}
// Retry button - Click
document.getElementById('retryBtn').addEventListener('click', () => {
  window.location.reload();
});
// Retry button - Enter or Space
window.addEventListener('keydown', (event) => {
  const retryBtn = document.getElementById('retryBtn');
  const overlayVisible = document.getElementById('gameOverOverlay').style.display === 'flex';
  if (overlayVisible && (event.code === 'Enter' || event.code === 'Space')) {
    retryBtn.click();  // Simulate button click
  }
});
let gameOver = false;


// ------------------ TAILLIGHT BRAKELIGHT FUNCTION ------------------
// Updates taillight light itensities based on braking status
function updateTailLights(isBraking) {
  const taillightNames = ["taillight_r2", "taillight_l1", "taillight_l2", "taillight_r1"];
  taillightNames.forEach(name => {
    // Retrieve tail light from player_car; if not found, try scene
    let tailLight = null;
    if (player_car) {
      tailLight = player_car.getObjectByName(name);
    }
    if (!tailLight) {
      tailLight = scene.getObjectByName(name);
    }
    if (tailLight && tailLight.userData.baseIntensity !== undefined) {
      tailLight.intensity = isBraking
        ? tailLight.userData.baseIntensity * 1.5  // Increases wattage when braking
        : tailLight.userData.baseIntensity;       // Resets to base wattage
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const delta = clock.getDelta();
  world.step(1 / 60, delta, 3);

  updateSkyscrapers(carBody.position.z); // Generate Skyscrapers based on Player Position

  if (gameOver) { // If game over (player crashed)
    document.querySelector("canvas").style.filter = "grayscale(1)"; // Black & white filter
    maxSpeed = 0;                                                       
  }

  // ---------- Input Controls ----------
  if (player_car && carBody) { // Update Player car based on input controls

    if (keyState.forward) {       // 'A' is pressed (Accelerate)
      let speedFactor = (maxSpeed - currentSpeed) / maxSpeed;
      let effectiveAcceleration = accelerationRate * speedFactor;

      // If turning, reduce acceleration more
      if (keyState.left || keyState.right) { 
        effectiveAcceleration *= 0.1;
      }

      currentSpeed += effectiveAcceleration * delta;
      if (currentSpeed > maxSpeed) currentSpeed = maxSpeed;
      if (brakingActive) {
        updateTailLights(false);
        brakingActive = false;
      }
    } else if (keyState.brake) {  // 'S' is pressed (Brake/Decelerate)
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

    // Record Score based on distance traveled
    if (currentSpeed > 0) {
      scoreValue += currentSpeed * delta;
    }
    const score = Math.floor(scoreValue * 0.5); // Score multiplier
    scoreDisplay.textContent = `Score: ${score}`;

    // ---------- Smoother Turning ----------
    // Increase or decrease turnAngularVelocity based on left/right (turning) inputs
    if (keyState.left) {
      turnAngularVelocity += turnAcceleration * delta;
      if (turnAngularVelocity > maxTurnSpeed) turnAngularVelocity = maxTurnSpeed;
    } else if (keyState.right) {
      turnAngularVelocity -= turnAcceleration * delta;
      if (turnAngularVelocity < -maxTurnSpeed) turnAngularVelocity = -maxTurnSpeed;
    } else {
      // When no turn key is pressed -> apply damping
      turnAngularVelocity *= turnDamping;
      if (Math.abs(turnAngularVelocity) < 0.001) turnAngularVelocity = 0;
    }

    // Compute the small incremental turn angle for this frame
    const turnAngle = turnAngularVelocity * delta;
    const turnQuaternion = new THREE.Quaternion();
    turnQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turnAngle);
    // Apply the rotation increment to the car's orientation
    player_car.quaternion.multiplyQuaternions(turnQuaternion, player_car.quaternion);
    // Copy the updated orientation to the physics body
    carBody.quaternion.copy(player_car.quaternion);

    // ---------- Update Car's Velocity ----------
    const forwardVector = new THREE.Vector3(0, 0, -1);
    forwardVector.applyQuaternion(player_car.quaternion).normalize();

    // If turning - reduce speed
    let effectiveSpeed = currentSpeed;
    if (keyState.left || keyState.right) {
      // Determine a reduction factor based on how strongly the car is turning.
      const reductionFactor = 0.5 * Math.min(Math.abs(turnAngularVelocity) / maxTurnSpeed, 1);
      effectiveSpeed = currentSpeed * (1 - reductionFactor);
    }
    // Set physics body's velocity in direction car is facing
    carBody.velocity.set(forwardVector.x * effectiveSpeed, carBody.velocity.y, forwardVector.z * effectiveSpeed);

    // Compute and set the visual offset for the car model
    const drawOffset = carOffsetY - 0.25;
    player_car.position.copy(carBody.position).add(new THREE.Vector3(0, drawOffset, 0));

    // Update visual infinite road
    updateRoad(carBody.position.z);

    // Update NPC car movement along the -z axis
    updateNPCCars(carBody.position.z, delta);

    // Animate Tire rotation based on forward movement
    const tireRadius = 0.3;
    const angularDelta = (currentSpeed * delta) / tireRadius;
    tires.forEach(tire => {
      if (tire) {
        tire.rotation.x -= angularDelta / 3;
      }
    });

    // ---------- Updated Camera Positioning ----------
    const carDirection = new THREE.Vector3();
    player_car.getWorldDirection(carDirection);

    // Compute the horizontal angle of the car's forward direction
    let carAngle = Math.atan2(carDirection.x, carDirection.z);

    if (introCameraAnimation && player_car) {
      // Increment the intro timer with delta time
      introTimer += delta;
      // t goes from 0 at the very start to 1 at the end of the intro
      const t = THREE.MathUtils.clamp(introTimer / INTRO_DURATION, 0, 1);

      // Get the car's forward direction and project it onto the horizontal plane
      const carForward = new THREE.Vector3();
      player_car.getWorldDirection(carForward);
      carForward.y = 0;
      carForward.normalize();
      const carAngle = Math.atan2(carForward.x, carForward.z);

      // Starting at the side of the car (here, carAngle + PI/3 places it to the side)
      const initialAngle = carAngle + Math.PI / 3;
      // Ending behind the car (carAngle)
      const finalAngle = carAngle;

      // Interpolate the horizontal angle
      const currentAngle = initialAngle + t * (finalAngle - initialAngle);

      // Interpolate the horizontal radius between the two distances.
      const currentRadius = THREE.MathUtils.lerp(cameraFrontDistance, cameraBehindDistance, t);

      // Compute the horizontal offset vector from the car's center
      const offsetX = Math.sin(currentAngle) * currentRadius;
      const offsetZ = Math.cos(currentAngle) * currentRadius;
      const offsetVec = new THREE.Vector3(offsetX, 0, offsetZ);

      // Compute the camera's vertical height by interpolating from the initial to the final height
      const currentHeight = THREE.MathUtils.lerp(cameraInitialHeight, cameraFinalHeight, t);

      // Compute the overall desired camera position:
      const desiredCameraPos = player_car.position.clone().add(offsetVec);
      desiredCameraPos.y += currentHeight;

      // Set camera position
      camera.position.copy(desiredCameraPos);

      // Have camera look at the car (slight upward adjustment)
      const lookAtPos = player_car.position.clone();
      lookAtPos.y += 2.25;
      camera.lookAt(lookAtPos);

      // End the intro phase once t reaches 1.
      if (t >= 1) {
        introCameraAnimation = false;
        introTimer = 0; // Reset timer so it can be reused on restart
      }
    } else if (player_car) {

      const cameraDistanceBehind = -2.5; 
      const carDirection = new THREE.Vector3();
      player_car.getWorldDirection(carDirection);
      const normalCameraHeight = 2.0;

      // Place the camera behind the car (opposite to its forward vector)
      const cameraOffset = carDirection.clone().negate().multiplyScalar(cameraDistanceBehind);
      const desiredCameraPos = player_car.position.clone().add(cameraOffset);
      desiredCameraPos.y += normalCameraHeight;

      // Apply smoothing (lag) on the X and Y axes; Z is snapped instantly
      const cameraSmoothFactor = 0.1;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, desiredCameraPos.x, cameraSmoothFactor);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, desiredCameraPos.y, cameraSmoothFactor);
      camera.position.z = desiredCameraPos.z;

      const adjustedPosition = player_car.position.clone();
      adjustedPosition.y += 2.25;
      camera.lookAt(adjustedPosition);
    }
  }
  scene.background.lerp(new THREE.Color(currentSpeed >= 99 ? 0x040308 : 0x070610), 0.05);

  // ---------- Top Speed Effect ----------
  if (currentSpeed >= 99) {
    // Top Speed - Enable Saturation Filter
    document.querySelector("canvas").style.filter = "saturate(2)";
    light.intensity = 0.45;
  } else {
    // Reset filter
    document.querySelector("canvas").style.filter = "";
    light.intensity = 0.6;
  }

  // ---------- Update HUD ----------
  const speedMPH = currentSpeed * 1.5;
  speedDisplay.textContent = `Speed: ${Math.round(speedMPH)} mph`;
  brakeStatus.style.display = keyState.brake ? 'block' : 'none';
  renderer.render(scene, camera);
}
animate();