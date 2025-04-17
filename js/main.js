// =========== LIBRARIES ===========
import * as THREE from 'https://cdn.skypack.dev/three@0.129.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://cdn.skypack.dev/three@0.129.0/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'https://cdn.skypack.dev/cannon-es';
import { keyState } from './controls.js';


// ========= SCENE ===========
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000030);   // Dark blue background (night sky)


// ========= CAMERA ===========
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 1, 5); // Initial camera position


// ========= LIGHTS ===========
const light = new THREE.DirectionalLight(0xffffff, 0.5);
light.position.set(5, 5, 5); // Light position
scene.add(light);


// ========= RENDERER ===========
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


// ========= ORBIT CONTROLS ===========
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Enables smooth orbit experience


// ========= HANDLE WINDOW RESIZE ===========
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


// ========= PHYSICS (CANNON) ===========
const world = new CANNON.World(); // Creates physics world with gravity
world.gravity.set(0, -9.82, 0); // Sets gravitational pull

// Creates infinite road (ground) collider using a Cannon Plane.
const groundMaterial = new CANNON.Material();
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({
    mass: 0, // Static body
    material: groundMaterial,
});
groundBody.addShape(groundShape);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Flattens ground so it lies at y = 0
world.addBody(groundBody);


// ========= LOAD 3D MODELS ===========
let player_car;
let carBody;  // The car's collision body
let carOffsetY = 0; // Offset computed from the model's bounding box for proper alignment
let tires = []; // Array to store tire meshes

// New: Car speed variables for acceleration and braking.
let currentSpeed = 40;         // Starting speed (units per second)
const maxSpeed = 90;           // Maximum speed allowed
const accelerationRate = 15;   // Speed increment per second when accelerating
const brakeDecelerationRate = 25; // Speed decrement per second when braking

const loader = new GLTFLoader();
loader.load(
    './assets/models/prototype_car.glb', // Path to player car model
    function (gltf) {
        player_car = gltf.scene;
        scene.add(player_car);

        // Compute the model's bounding box so its bottom aligns at y = 0.
        const bbox = new THREE.Box3().setFromObject(player_car);
        carOffsetY = -bbox.min.y;
        player_car.position.set(0, carOffsetY, 0);

        // ========= CAR COLLISION =========
        // Approximate the car with a box collider of half-extents (0.5, 0.25, 1)
        // which gives a full size of (1, 0.5, 2). The car's bottom touches y = 0 when its center is at y = 0.25.
        const carShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 1));
        carBody = new CANNON.Body({
            mass: 150,  // Car mass
        });
        carBody.addShape(carShape);
        // Position the car above the road to allow gravity to pull it down initially.
        carBody.position.set(0, 1.5, 0);
        carBody.fixedRotation = true;  
        carBody.updateMassProperties();
        world.addBody(carBody);

        // Retrieve the existing Spot light from the Blender model hierarchy
        const spotLight = player_car.getObjectByName("Spot");
        if (spotLight) {
            // Parent the Spot light to the player_car so it moves with the car
            player_car.add(spotLight);
        } else {
            console.error("Spot light not found in the Blender hierarchy");
        }

        // Retrieve tire meshes from the car model hierarchy.
        const frontLeftTire = player_car.getObjectByName("front_l_tire");
        const frontRightTire = player_car.getObjectByName("front_r_tire");
        const backLeftTire = player_car.getObjectByName("back_l_tire");
        const backRightTire = player_car.getObjectByName("back_r_tire");
        tires = [frontLeftTire, frontRightTire, backLeftTire, backRightTire];

        // Update the camera position once the car is loaded.
        camera.position.set(0.15, 1.2, 2.5);
        camera.lookAt(player_car.position);
    },
    undefined,
    function (error) {
        console.error('Error loading model:', error);
    }
);
/** ========= VISUAL INFINITE ROAD =========
 *  Creates a visual representation of a highway-style road segment.
 *  Note: The visual road is rendered independently; collision detection
 *  is managed by an infinite ground plane in the physics simulation.
 */
const laneCount = 4;
const laneWidth = 3;
const roadTotalWidth = laneCount * laneWidth;
const segmentLength = 50;
const numSegments = 20;
const roadSegments = [];

function createRoadSegment(zPosition) {
    const roadSegmentGroup = new THREE.Group();

    // ========= ASPHALT BASE =========
    const asphaltGeometry = new THREE.PlaneGeometry(roadTotalWidth, segmentLength);
    const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const asphaltMesh = new THREE.Mesh(asphaltGeometry, asphaltMaterial);
    asphaltMesh.rotation.x = -Math.PI / 2;
    roadSegmentGroup.add(asphaltMesh);

    // ========= DASHED LINES =========
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
    roadSegmentGroup.position.set(0, 0, zPosition);
    scene.add(roadSegmentGroup);
    return roadSegmentGroup; // Returns Finished Road Segment
}
// Initialize road segments at Player's initial Z position
const carStartZ = 0;
// Creates continuous road segments along -Z axis
for (let i = 0; i < numSegments; i++) {
    roadSegments.push(createRoadSegment(carStartZ - i * segmentLength));
}
// When a road segment passes the Player's Z position -> Recycles road segment
function updateRoad(playerPositionZ) {
    roadSegments.forEach(segment => {
        if (segment.position.z > playerPositionZ + segmentLength) {
            segment.position.z -= numSegments * segmentLength;
        }
    });
}


// ========= ANIMATION & PHYSICS UPDATE =========
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    const delta = clock.getDelta();
    world.step(1 / 60, delta, 3);

    if (player_car && carBody) {
        // Update car speed based on controls:
        if (keyState.forward) {
            // Accelerate: Increase speed, but do not exceed maxSpeed.
            currentSpeed += accelerationRate * delta;
            if (currentSpeed > maxSpeed) currentSpeed = maxSpeed;
        } else if (keyState.brake) {
            // Brake: Decrease speed; do not go below 0.
            currentSpeed -= brakeDecelerationRate * delta;
            if (currentSpeed < 0) currentSpeed = 0;
        } else {
            // Idle: Decrease speed at a slower rate; Do not go below 0
            currentSpeed -= brakeDecelerationRate * delta/10;
            if (currentSpeed < 0) currentSpeed = 0;
        }
        // Apply the computed velocity. (Car moves in the -Z direction.)
        carBody.velocity.set(0, carBody.velocity.y, -currentSpeed);

        // Compute draw offset: If carBody's center is y = 0.25, then the model's bottom is at y = 0.
        const drawOffset = carOffsetY - 0.25;
        player_car.position.copy(carBody.position).add(new THREE.Vector3(0, drawOffset, 0));
        player_car.quaternion.copy(carBody.quaternion);

        // Update visual infinite road.
        updateRoad(carBody.position.z);

        // Animate tires to rotate based on car's forward travel.
        const tireRadius = 0.3;
        // Calculate angular rotation (in radians) based on distance traveled.
        const angularDelta = (currentSpeed * delta) / tireRadius;
        tires.forEach(tire => {
            if (tire) {
                // Adjust tire rotation in accordance with travel direction.
                tire.rotation.x -= angularDelta / 3;
            }
        });
        // Make the camera follow the car (positioned slightly above the car).
        camera.position.z = carBody.position.z + 2.5;
        const adjustedPosition = player_car.position.clone();
        adjustedPosition.y += 2.25;
        camera.lookAt(adjustedPosition);
    }
    renderer.render(scene, camera);
}
animate();