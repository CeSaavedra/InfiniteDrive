// Create an object to track the current key states.
const keyState = {
  forward: false, // True when "W" is pressed.
  brake: false,   // True when "S" is pressed.
  left: false,    // True when "A" is pressed.
  right: false    // True when "D" is pressed.
};

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyW') {
    keyState.forward = true;
  } else if (event.code === 'KeyS') {
    keyState.brake = true;
  } else if (event.code === 'KeyA') {
    keyState.left = true;
  } else if (event.code === 'KeyD') {
    keyState.right = true;
  }
});

// Listen for keyup events to reset the key flags.
window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyW') {
    keyState.forward = false;
  } else if (event.code === 'KeyS') {
    keyState.brake = false;
  } else if (event.code === 'KeyA') {
    keyState.left = false;
  } else if (event.code === 'KeyD') {
    keyState.right = false;
  }
});

// Export the keyState object for main.js to import
export { keyState };
