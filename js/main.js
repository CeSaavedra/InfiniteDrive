// -------------- LIBRARIES --------------
import * as THREE from 'https://cdn.skypack.dev/three@0.129.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { keyState } from './controls.js';

document.addEventListener('DOMContentLoaded', () => {

  /** ==================================================================
   *  SCENE / CAMERA / AUDIO / LIGHTS / RENDERER / CONTROLS
   *  Core Three.js setup: scene graph, camera, listener/audio, lighting,
   *  the WebGL renderer, orbit controls, and the window resize handler
   *///==================================================================

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

  // ------------------ AUDIO ------------------
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const engineSound = new THREE.Audio(listener);  // Enging Sound Audio
  const audioLoader = new THREE.AudioLoader();    // Car Crash Audio

  audioLoader.load('assets/audio/engine_loop.mp3', buffer => {
    engineSound.setBuffer(buffer);
    engineSound.setLoop(true);
    engineSound.setVolume(0.025);
  });

  const carCrashSound = new THREE.Audio(listener);
  audioLoader.load('assets/audio/car_crash.mp3', buffer => {
    carCrashSound.setBuffer(buffer);
    carCrashSound.setVolume(0.05);
  });

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


  /** ==================================================================
   *  PHYSICS (CANNON)
   *  Physics world + the infinite road (ground) collider.
   *///==================================================================
  const world = new CANNON.World(); // Creates physics world with gravity
  world.gravity.set(0, -9.82, 0);   // Sets gravitational pull

  const COLLISION_GROUP_GROUND = 1;
  const COLLISION_GROUP_PLAYER = 2;
  const COLLISION_GROUP_NPC = 4;

  const groundMaterial = new CANNON.Material();
  const groundShape = new CANNON.Plane();
  const groundBody = new CANNON.Body({
    mass: 0,
    material: groundMaterial,
  });
  groundBody.addShape(groundShape);
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.collisionFilterGroup = COLLISION_GROUP_GROUND;
  groundBody.collisionFilterMask = COLLISION_GROUP_PLAYER;
  world.addBody(groundBody);

  /** ==================================================================
   *  GLOBAL VARIABLES
   *///==================================================================

  // ---------------- HUD ELEMENTS ----------------
  const speedDisplay = document.getElementById('speedDisplay');
  const scoreDisplay = document.getElementById('scoreDisplay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const pauseBtn = document.getElementById('pauseBtn'); 
  const startOverlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');

  // Menu DOM references
  const playContainer = document.querySelector('.menu__play');
  const instrContainer = document.querySelector('.menu__instructions');
  const optionsList = document.querySelector('.menu__options');
  const playGameBtn = document.getElementById('playGameBtn');
  const howToPlayBtn = document.getElementById('howToPlayBtn');
  const playBackBtn = document.getElementById('playBackBtn');
  const instrBackBtn = document.getElementById('instrBackBtn');

  // Player car values
  let player_car;                         // Declares Player's Car
  let menuModel;
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
  const carStartZ = 0;                    // Player's initial Z position
  let globalNPCCarModel = null;           // NPC car model
  let globalBarrierModel = null;          // Road barrier model
  let globalLightBarrierModel = null;     // Road light barrier model
  let globalTestLightModel = null;        // Street light spotlight model to be placed in middle
  let scoreValue = 0;

  // Game / UI state
  let isPaused = false;
  let isMuted = false;
  let gameOver = false;
  let gameStarted = false;
  let readyToPause = false;
  let hasFocused = false;
  let rainbowInterval = null;
  let bobTime = 0;
  const sparkThreshold = 99;
  let lastSparkTime = 0;
  let spawnChance = 0.99;
  let spawnRate = 1;

  // Braking / clock
  const clock = new THREE.Clock();  // Three.js Clock
  let brakingActive = false;        // Tracks braking state

  // Turning values (persist between frames)
  let turnAngularVelocity = .1;
  const maxTurnSpeed = 1.5;       // Maximum angular speed (radians per second)
  const turnAcceleration = 2.5;   // Angular acceleration (radians per second^2)
  const turnDamping = 0.9;        // Damping factor when no turn inputs are active

  // Intro camera animation values
  let introCameraAnimation = true;  // Set to True at game start
  let introTimer = 0;
  const INTRO_DURATION = 2;         // Duration of the Intro rotation
  const cameraFrontDistance = 2;    // Distance in front of the car
  const cameraBehindDistance = 2.5; // Distance behind the car
  const cameraInitialHeight = 1.2;  // Initial camera height (starts lower)
  const cameraFinalHeight = 2.0;    // Camera height at end of intro

  // Menu scene values
  const menuScene = new THREE.Scene();
  let menuCamera, menuControls;


  /** ========================== 3D CAR MODELS ==========================
   * The following segment of code retrieves the 3D models (glb) in the
   * assets->models folder, and inserts them into the scene. The retrieved
   * models consist of the Player Car and the NPC cars. The car's speed,
   * physics, tires, and lights are defined in this segment.
   *///==================================================================

  // ==================== LOAD PLAYER CAR MODEL ====================
  const loader = new GLTFLoader();
  loader.load(
    './assets/models/player_car.glb', // Player Car Model Path
    function (gltf) {
      player_car = gltf.scene;
      scene.add(player_car);

      // Compute the model's bounding box so its bottom aligns at y = 0.
      const bbox = new THREE.Box3().setFromObject(player_car);
      carOffsetY = -bbox.min.y;
      player_car.position.set(0, carOffsetY, 0);
      const carShape = new CANNON.Box(new CANNON.Vec3(0.6, 0.25, 1.25));
      carBody = new CANNON.Body({ mass: 150 });

      const carOffset = new CANNON.Vec3(0.2, 0, -1.0); 
      carBody.addShape(carShape, carOffset);

      carBody.position.set(0, 0.5, 0);
      carBody.fixedRotation = true;
      carBody.collisionFilterGroup = COLLISION_GROUP_PLAYER;
      carBody.collisionFilterMask = COLLISION_GROUP_GROUND | COLLISION_GROUP_NPC;
      carBody.updateMassProperties();
      world.addBody(carBody);
      player_car.userData.physicsBody = carBody;

      // ==================== COLLISION LISTENERS (registered once) ====================
      carBody.addEventListener("collide", function (e) {
        if (e.body && e.body.isNPC) {
          triggerGameOver();
        }
      });
      carBody.addEventListener("collide", function (event) {
        if (event.body && event.body.isWall) {
          triggerGameOver();
        }
      });

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
    const npcSpeed = 30;
    const activeRearZ = playerPositionZ + 100;
    const activeFrontZ = playerPositionZ - 1100;
    const tireRadius = 0.3;
    const angularDelta = (npcSpeed * delta) / tireRadius;

    roadSegments.forEach(segment => {
      const npcCars = segment.userData.npcCars;
      if (!npcCars || npcCars.length === 0) return;

      // Iterate backward so splice() during removal doesn't skip elements
      for (let i = npcCars.length - 1; i >= 0; i--) {
        const npc = npcCars[i];

        npc.userData.globalZ -= npcSpeed * delta;
        npc.position.z = npc.userData.globalZ - segment.position.z;

        if (npc.userData.physicsBody) {
          npc.userData.physicsBody.position.set(npc.position.x, 0.5, npc.userData.globalZ);
        }

        if (npc.userData.npcTires === undefined) {
          npc.userData.npcTires = [
            npc.getObjectByName("front_l_tire"),
            npc.getObjectByName("front_r_tire"),
            npc.getObjectByName("back_l_tire"),
            npc.getObjectByName("back_r_tire")
          ];
        }

        const npcTires = npc.userData.npcTires;
        for (let t = 0; t < npcTires.length; t++) {
          const tireGroup = npcTires[t];
          if (tireGroup && tireGroup.children && tireGroup.children.length > 0) {
            const children = tireGroup.children;
            for (let c = 0; c < children.length; c++) {
              children[c].rotation.x -= angularDelta;
            }
          }
        }

        if (npc.userData.globalZ > activeRearZ || npc.userData.globalZ < activeFrontZ) {
          if (npc.userData.physicsBody) world.removeBody(npc.userData.physicsBody);
          if (npc.userData.clonedMaterials) {
            npc.userData.clonedMaterials.forEach(mat => mat.dispose());
          }
          segment.remove(npc);
          npcCars.splice(i, 1);
        }
      }
    });
  }
  // ==================== SETS SPAWNED NPC CAR ====================
  const NPC_COLORS = [
    0x9F1616, 0x084DDD, 0xF1B000, 0xD5D5D5, 0x132116, 0x071E49, 0xD77500, 0x330078,
    0xC0392B, 0x2980B9, 0x27AE60, 0xF39C12, 0x8E44AD, 0x16A085, 0xE74C3C, 0x2C3E50,
    0xD35400, 0x2ECC71, 0x1ABC9C, 0x34495E, 0xE67E22, 0x7F8C8D, 0xBDC3C7, 0x95A5A6,
    0x6C3483, 0xA93226, 0x1F618D, 0x148F77, 0xB9770E, 0x922B21, 0x7D3C98, 0x186A3B,
    0xFF5733, 0xC70039, 0x900C3F, 0x581845, 0xFFC300, 0xDAF7A6, 0x3498DB, 0x9B59B6
  ];

  const _laneScratch = Array.from({ length: laneCount }, (_, i) => i);
  function pickRandomLanes(count) {
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (laneCount - i));
      const tmp = _laneScratch[i];
      _laneScratch[i] = _laneScratch[j];
      _laneScratch[j] = tmp;
    }
    return _laneScratch;
  }

  function spawnNPCCar(segment) {
    if (!globalNPCCarModel) {
      segment.userData.needNPCCar = true;
      return;
    }
    delete segment.userData.needNPCCar;

    segment.userData.npcCars = [];

    const lanes = pickRandomLanes(spawnRate); 

    for (let laneI = 0; laneI < spawnRate; laneI++) {
      const laneIndex = lanes[laneI];
      const npcCar = globalNPCCarModel.clone();
      npcCar.rotation.y = -Math.PI;
      npcCar.scale.set(1, 1, 1);

      const clonedMaterials = [];

      const mainFrame = npcCar.getObjectByName("main_frame");
      if (mainFrame) {
        const chosenColor = NPC_COLORS[Math.floor(Math.random() * NPC_COLORS.length)];
        const NPC_METALNESS = 0.6;
        const NPC_ROUGHNESS = 0.25;

        mainFrame.traverse(child => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
              const originalMat = child.material[0];
              child.material[0] = originalMat.clone();
              child.material[0].color.setHex(chosenColor);
              if ('metalness' in child.material[0]) {
                child.material[0].metalness = NPC_METALNESS;
                child.material[0].roughness = NPC_ROUGHNESS;
              }
              child.material[0].needsUpdate = true;
              clonedMaterials.push(child.material[0]);
            } else {
              child.material = child.material.clone();
              child.material.color.setHex(chosenColor);
              if ('metalness' in child.material) {
                child.material.metalness = NPC_METALNESS;
                child.material.roughness = NPC_ROUGHNESS;
              }
              child.material.needsUpdate = true;
              clonedMaterials.push(child.material);
            }
          }
        });
      }

      const laneX = -roadTotalWidth / 2 + laneWidth / 2 + laneIndex * laneWidth;
      const offsetZ = THREE.MathUtils.randFloat(-segmentLength / 4, segmentLength / 4);
      npcCar.position.set(laneX, 0.36, offsetZ);

      npcCar.userData.globalZ = segment.position.z + npcCar.position.z;
      segment.add(npcCar);
      segment.userData.npcCars.push(npcCar);

      const halfExtents = new CANNON.Vec3(0.55, 0.5, 1.5);
      const collisionShape = new CANNON.Box(halfExtents);
      const collisionBody = new CANNON.Body({ mass: 500 });
      const offset = new CANNON.Vec3(-0.04, 0.2, 2.0);
      collisionBody.addShape(collisionShape, offset);

      collisionBody.position.set(laneX, 0.5, npcCar.userData.globalZ);
      collisionBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, .25, 0), -Math.PI);
      collisionBody.isNPC = true;

      collisionBody.collisionFilterGroup = COLLISION_GROUP_NPC;
      collisionBody.collisionFilterMask = COLLISION_GROUP_PLAYER;

      world.addBody(collisionBody);
      npcCar.userData.physicsBody = collisionBody;
      npcCar.userData.clonedMaterials = clonedMaterials;
    }
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
      const newTarget = new THREE.Object3D();
      newTarget.name = "RebuiltSpotTarget";
      newTarget.position.set(0, -5, 0);
      container.add(newTarget);
      newSpot.target = newTarget;
      newSpot.target.updateMatrixWorld();
      container.add(newSpot);

    } else {
      console.warn("No spotlight found in the original test light model; cloning entire model instead.");
      container.add(globalTestLightModel.clone(true));
    }
    let accessories = globalTestLightModel.clone(true);
    accessories.traverse(child => {
      if (child.isSpotLight) {
        if (child.parent) child.parent.remove(child);
      }
    });
    container.add(accessories);
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
      leftWallBody.isWall = true;
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

    // ADD BARRIERS
    if (globalBarrierModel || globalLightBarrierModel) {
      addBarriersToSegment(roadSegmentGroup);
    }

    if (roadSegmentGroup.userData.useLightBarrier && globalTestLightModel && !roadSegmentGroup.userData.hasMiddleTestLight) {
      insertMiddleTestLightIntoSegment(roadSegmentGroup);
      roadSegmentGroup.userData.hasMiddleTestLight = true;
    }

    // Set the segment's position.
    roadSegmentGroup.position.set(0, 0, zPosition);

    // ADD COLLIDABLE WALLS.
    addCollidableWallsToSegment(roadSegmentGroup);

    // SPAWN NPC CAR.
    if (Math.random() < spawnChance) {
      spawnNPCCar(roadSegmentGroup);
    }

    scene.add(roadSegmentGroup);
    return roadSegmentGroup;
  }

  // ==================== ROAD UPDATE FUNCTION ====================
  function updateRoad(playerPositionZ) {
    roadSegments.forEach(segment => {
      if (segment.position.z > playerPositionZ + segmentLength) {
        segment.position.z -= numSegments * segmentLength;
        if (!segment.userData.hasBarriers) addBarriersToSegment(segment);
        addCollidableWallsToSegment(segment);

        if ((!segment.userData.npcCars || segment.userData.npcCars.length === 0) && Math.random() < spawnChance) {
          spawnNPCCar(segment);
        }
      }
    });
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
  const spawnedSkyscrapers = []; // Array to keep track of the instantiated skyscraper meshes

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

  function spawnSkyscrapers() {
    // Increased spacing along the Z axis and fewer rows
    const spacing = 25;       // Base spacing for each row
    const numOfRows = 20;     // Fewer rows per update
    const baseScale = 2;      // Base scale value for width and depth
    const roadCenterZ = 0;

    // List of available colors (red, blue, green) for window emission
    const windowColors = [
      0xE04A4A, 0xCF9F65, 0xECE172, 0x7A9AC5, 0xB07AC5,
      0xC93E3E, 0xF06060, 0xB88A55, 0xE0B078, 0xD4C560,
      0xF5EC85, 0x6A87B8, 0x8FADD9, 0x9868A8, 0xC594D9
    ];

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

  // ------------------- END-GAME UI FUNCTION ------------------
  // Triggers the end-game UI overlay that displays final score and offers to retry attempt
  function triggerGameOver() {
    gameOver = true;
    engineSound.stop();
    carCrashSound.play();

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


  /** ==================== MENU / START SCREEN ====================
   *  Loads the 3D main-menu background scene/camera, wires up the
   *  menu -> play/instructions panels, and starts the game.
   *///===============================================================

  new GLTFLoader().load('assets/models/menu-screen.glb', gltf => {
    menuModel = gltf.scene;

    menuScene.add(gltf.scene);

    const srcCam = gltf.scene.getObjectByName('blender_cam') ||
      gltf.cameras.find(c => c.isCamera);
    if (!srcCam) {
      return console.error('No camera named "blender_cam" in menu-screen.glb');
    }

    menuCamera = srcCam.clone(true);
    menuCamera.position.set(0.826, 2.826, 0.597);
    menuCamera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(
        menuCamera.position,
        new THREE.Vector3(0.829, 2.824, 0.622),
        menuCamera.up
      )
    );
    menuCamera.updateProjectionMatrix();
    menuScene.add(menuCamera);

    menuControls = new OrbitControls(menuCamera, renderer.domElement);
    menuControls.enableDamping = true;
    menuControls.target.set(0.829, 2.824, 0.622);
    menuControls.update();
  });

  function resetState() {
    currentSpeed = 40;
    scoreValue = 0;
    gameOver = false;
    introCameraAnimation = true;
    introTimer = 0;
  }

  function initGame() {
    if (gameStarted) return;
    setTimeout(() => {
      readyToPause = true;
    }, 2000);
    gameStarted = true;
    const gameHUD = document.getElementById('hud');
    gameHUD.style.display = "block";
    const settingsHUD = document.getElementById('settingsOverlay');
    settingsHUD.style.display = "flex";

    startOverlay.style.display = 'none';
    resetState();

    // ==================== INITIALIZATION ====================
    for (let i = 0; i < numSegments; i++) {
      // Each segment is positioned relative to the player's starting z-position.
      roadSegments.push(createRoadSegment(i, carStartZ - i * segmentLength));
    }
  }

  // FORCE initial visibility
  optionsList.style.display = 'flex';
  playContainer.style.display = 'none';
  instrContainer.style.display = 'none';

  playGameBtn.addEventListener('click', () => {
    optionsList.style.display = 'none';
    playContainer.style.display = 'flex';
  });

  howToPlayBtn.addEventListener('click', () => {
    optionsList.style.display = 'none';
    instrContainer.style.display = 'flex';
  });

  playBackBtn.addEventListener('click', () => {
    playContainer.style.display = 'none';
    optionsList.style.display = 'flex';
  });

  instrBackBtn.addEventListener('click', () => {
    instrContainer.style.display = 'none';
    optionsList.style.display = 'flex';
  });

  //startBtn.addEventListener("click", () => engineSound.play());
  startBtn.addEventListener('click', initGame);

  // Utility: traverse & apply color
  function colorize(root, hex) {
    root.traverse(child => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      mats.forEach(m => {
        if (m.name === 'MAIN' || m.name === 'Material.011') {
          m.color.setHex(hex);
        }
      });
    });
  }


  /** ===================================================================
  /** ======================== PAGE PROPERTIES ==========================
  *///===================================================================

  window.addEventListener('focus', () => {
    hasFocused = true;
  });
  window.addEventListener('blur', () => {
    if (readyToPause && !isPaused) setPaused(true);
  });
  window.addEventListener('load', () => {
    document.getElementById('loading-screen').style.display = 'none';
  });

  document.querySelectorAll('.difficulty-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const chanceRates = [0.25, 0.5, 0.8];
      const spawnRates = [1, 2, 3];
      spawnRate = spawnRates[index];
      spawnChance = chanceRates[index];
    });
  });

  document.querySelector('.difficulty-btn.active')?.click();

  // Color Buttons
  document.querySelectorAll('.color-circle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-circle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (rainbowInterval) {
        clearInterval(rainbowInterval);
        rainbowInterval = null;
      }

      if (btn.dataset.color === 'rainbow') {
        let hue = 0;
        rainbowInterval = setInterval(() => {
          hue = (hue + 2) % 360;
          const hex = new THREE.Color(`hsl(${hue}, 100%, 50%)`).getHex();
          if (player_car) colorize(player_car, hex);
          if (menuModel) colorize(menuModel, hex);
        }, 20);
      } else {
        const hex = new THREE.Color(btn.dataset.color).getHex();
        if (player_car) colorize(player_car, hex);
        if (menuModel) colorize(menuModel, hex);
      }
    });
  });

  function setPaused(paused) {
    if (isPaused === paused) return;
    isPaused = paused;

    document.getElementById('icon-pause').style.display = isPaused ? 'none' : 'inline';
    document.getElementById('icon-play').style.display = isPaused ? 'inline' : 'none';

    if (!isPaused) {
      document.querySelector("canvas").style.filter = "";
    }
  }

  pauseBtn.addEventListener('click', () => setPaused(!isPaused));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      setPaused(!isPaused);
    }
  });

  function setMute(muted) {
    if (isMuted === muted) return;
    isMuted = muted;

    document.getElementById('icon-unmuted').style.display = isMuted ? 'none' : 'inline';
    document.getElementById('icon-muted').style.display = isMuted ? 'inline' : 'none';
  }

  muteBtn.addEventListener('click', () => setMute(!isMuted));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      setMute(!isMuted);
    }
  });

  function spawnSpark() {
    const spark = document.createElement('div');
    spark.className = 'spark';
    const wrapperWidth = speedDisplayWrapper.offsetWidth;
    spark.style.left = `${Math.random() * wrapperWidth}px`;
    spark.style.setProperty('--drift', `${(Math.random() - 0.5) * 30}px`);
    speedDisplayWrapper.appendChild(spark);
    setTimeout(() => spark.remove(), 800);
  }


  /** ===================================================================
  /** ==================== GAME ANIMATION LOOP ==========================
   *///==================================================================
  const canvasEl = renderer.domElement; // avoids repeated document.querySelector("canvas")

  const _turnQuaternion = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _forwardVector = new THREE.Vector3();
  const _drawOffsetVec = new THREE.Vector3();

  const _camDirTmp = new THREE.Vector3();      // reused for getWorldDirection calls
  const _offsetVecTmp = new THREE.Vector3();   // intro camera offset
  const _desiredCamPos = new THREE.Vector3();  // intro + normal camera desired pos
  const _lookAtTmp = new THREE.Vector3();      // camera lookAt target

  const _bgColorDark = new THREE.Color(0x040308);
  const _bgColorNormal = new THREE.Color(0x070610);

  let smoothedSpeed = 0; // tracks the velocity magnitude actually applied, eased toward effectiveSpeed

  const _colorStops = [
    { r: 255, g: 255, b: 255 }, // original/white
    { r: 255, g: 165, b: 0 },   // orange
    { r: 255, g: 0, b: 0 }      // red
  ];

  const BASE_FOV = 75;      // matches initial camera FOV
  const MAX_FOV_BOOST = 20; // extra degrees of FOV at max speed
  const FOV_EXPONENT = 3;   // higher = curve stays flatter longer, then rises sharply near max speed
  let lastAppliedFov = BASE_FOV;

  function animate() {

    if (gameOver) {
      if (engineSound.isPlaying) {
        engineSound.stop();
      }
      canvasEl.style.filter = "grayscale(1)"; // Black & white filter
      return;
    }

    requestAnimationFrame(animate);

    if (!gameStarted) {
      // slower time advance
      bobTime += 0.002;

      if (!menuCamera) return;

      const bobY = Math.cos(bobTime * 1.1) * 0.001;
      menuCamera.position.y = 2.826 + bobY;

      menuControls.update();
      renderer.render(menuScene, menuCamera);
      return;
    }

    if (isPaused) {
      if (engineSound.isPlaying) {
        engineSound.stop();
      }
      canvasEl.style.filter = "grayscale(1)"; // Black & white filter
      renderer.render(scene, camera);
      return;
    }
    listener.setMasterVolume(isMuted ? 0 : 1);

    if (!engineSound.isPlaying) {
      engineSound.play();
    }

    const delta = clock.getDelta();
    world.step(1 / 60, delta, 3);


    updateSkyscrapers(carBody.position.z); // Generate Skyscrapers based on Player Position

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
      const score = Math.floor(scoreValue * 0.5);
      scoreDisplay.textContent = `Score: ${score}`;

      // --- Engine audio pitch & volume ---
      if (engineSound && engineSound.isPlaying) {

        // Normalize speed 0 → 1
        const speedNorm = THREE.MathUtils.clamp(currentSpeed / maxSpeed, 0, 1);

        // Pitch scaling
        const minPitch = 0.8;
        const maxPitch = 2.0;
        engineSound.setPlaybackRate(THREE.MathUtils.lerp(minPitch, maxPitch, speedNorm));

        // Volume scaling (louder when fast)
        const minVol = 0.025;
        const maxVol = 0.05;
        engineSound.setVolume(THREE.MathUtils.lerp(minVol, maxVol, speedNorm));
      }

      // --- FOV scaling: exponential increase as speed approaches max ---
      const fovRatio = THREE.MathUtils.clamp(currentSpeed / maxSpeed, 0, 1);
      const fovCurve = Math.pow(fovRatio, FOV_EXPONENT);
      const targetFov = BASE_FOV + MAX_FOV_BOOST * fovCurve;
      if (Math.abs(targetFov - lastAppliedFov) > 0.01) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
        lastAppliedFov = targetFov;
      }


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
      _turnQuaternion.setFromAxisAngle(_yAxis, turnAngle);
      // Apply the rotation increment to the car's orientation
      player_car.quaternion.multiplyQuaternions(_turnQuaternion, player_car.quaternion);
      // Copy the updated orientation to the physics body
      carBody.quaternion.copy(player_car.quaternion);

      // ---------- Update Car's Velocity ----------
      _forwardVector.set(0, 0, -1);
      _forwardVector.applyQuaternion(player_car.quaternion).normalize();

      // If turning - reduce speed
      let effectiveSpeed = currentSpeed;
      if (keyState.left || keyState.right) {
        // Determine a reduction factor based on how strongly the car is turning.
        const reductionFactor = 0.5 * Math.min(Math.abs(turnAngularVelocity) / maxTurnSpeed, 1);
        effectiveSpeed = currentSpeed * (1 - reductionFactor);
      }
      // Set physics body's velocity in direction car is facing
      // NEW: ease toward effectiveSpeed instead of snapping to it
      const speedSmoothFactor = 0.1; // lower = smoother/slower catch-up, higher = snappier
      smoothedSpeed = THREE.MathUtils.lerp(smoothedSpeed, effectiveSpeed, speedSmoothFactor);
      carBody.velocity.set(_forwardVector.x * smoothedSpeed, carBody.velocity.y, _forwardVector.z * smoothedSpeed);
      // Compute and set the visual offset for the car model
      const drawOffset = carOffsetY - 0.25;
      _drawOffsetVec.set(0, drawOffset, 0);
      player_car.position.copy(carBody.position).add(_drawOffsetVec);

      // Update visual infinite road
      updateRoad(carBody.position.z);

      // Update NPC car movement along the -z axis
      updateNPCCars(carBody.position.z, delta);

      // Animate Tire rotation based on forward movement
      const tireRadius = 0.3;
      const angularDelta = (currentSpeed * delta) / tireRadius;
      for (let i = 0; i < tires.length; i++) {
        const tire = tires[i];
        if (tire) tire.rotation.x -= angularDelta / 3;
      }

      // ---------- Updated Camera Positioning ----------
      if (introCameraAnimation && player_car) {
        // Increment the intro timer with delta time
        introTimer += delta;
        // t goes from 0 at the very start to 1 at the end of the intro
        const t = THREE.MathUtils.clamp(introTimer / INTRO_DURATION, 0, 1);

        // Get the car's forward direction and project it onto the horizontal plane
        player_car.getWorldDirection(_camDirTmp);
        _camDirTmp.y = 0;
        _camDirTmp.normalize();
        const carAngle = Math.atan2(_camDirTmp.x, _camDirTmp.z);

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
        _offsetVecTmp.set(offsetX, 0, offsetZ);

        // Compute the camera's vertical height by interpolating from the initial to the final height
        const currentHeight = THREE.MathUtils.lerp(cameraInitialHeight, cameraFinalHeight, t);

        // Compute the overall desired camera position:
        _desiredCamPos.copy(player_car.position).add(_offsetVecTmp);
        _desiredCamPos.y += currentHeight;

        // Set camera position
        camera.position.copy(_desiredCamPos);

        // Have camera look at the car
        _lookAtTmp.copy(player_car.position);
        _lookAtTmp.y += 2.25;
        camera.lookAt(_lookAtTmp);

        // End the intro phase once t reaches 1.
        if (t >= 1) {
          introCameraAnimation = false;
          introTimer = 0;
        }
      } else if (player_car) {

        const cameraDistanceBehind = -2.5;
        player_car.getWorldDirection(_camDirTmp);
        const normalCameraHeight = 2.0;

        // Place the camera behind the car (opposite to its forward vector)
        _offsetVecTmp.copy(_camDirTmp).negate().multiplyScalar(cameraDistanceBehind);
        _desiredCamPos.copy(player_car.position).add(_offsetVecTmp);
        _desiredCamPos.y += normalCameraHeight;

        // Apply smoothing (lag) on the X and Y axes; Z is snapped instantly
        const cameraSmoothFactor = 0.1;
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, _desiredCamPos.x, cameraSmoothFactor);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, _desiredCamPos.y, cameraSmoothFactor);
        camera.position.z = _desiredCamPos.z;

        _lookAtTmp.copy(player_car.position);
        _lookAtTmp.y += 2.25;
        camera.lookAt(_lookAtTmp);
      }
    }
    scene.background.lerp(currentSpeed >= 99 ? _bgColorDark : _bgColorNormal, 0.05);

    const newFilter = currentSpeed >= 99 ? "saturate(1.25)" : "";
    if (canvasEl.style.filter !== newFilter) canvasEl.style.filter = newFilter;
    light.intensity = currentSpeed >= 99 ? 0.45 : 0.6;

    // ---------- Update HUD ----------
    const speedMPH = currentSpeed * 1.4;
    speedDisplay.textContent = `${Math.round(speedMPH)} MPH`;
    renderer.render(scene, camera);



    const speedRatio = THREE.MathUtils.clamp(currentSpeed / maxSpeed, 0, 1);
    const easedRatio = Math.pow(speedRatio, 4);

    const segment = easedRatio * (_colorStops.length - 1);
    const index = Math.min(Math.floor(segment), _colorStops.length - 2);
    const localT = segment - index;

    const from = _colorStops[index];
    const to = _colorStops[index + 1];

    const r = Math.round(THREE.MathUtils.lerp(from.r, to.r, localT));
    const g = Math.round(THREE.MathUtils.lerp(from.g, to.g, localT));
    const b = Math.round(THREE.MathUtils.lerp(from.b, to.b, localT));

    speedDisplay.style.color = `rgb(${r}, ${g}, ${b})`;

    if (currentSpeed > sparkThreshold) {
      const now = performance.now();
      if (now - lastSparkTime > 60) {
        lastSparkTime = now;
        spawnSpark();
      }
    }
  }
  animate();
});