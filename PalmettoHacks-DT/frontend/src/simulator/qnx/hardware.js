// Catalog of the QNX rig shown on the simulator map.
// PLACEHOLDER SPECS: replace the names and numbers below with the team's real
// parts. The hover cards read everything from here, so no UI changes are needed.

export const QNX_BASE = { x: 2260, y: 700, width: 190, height: 330 }; // metres within the site map
export const CONTROL_LOOP_HZ = 100;

export const BASE_PART = {
  title: "QNX base controller",
  hardware: "Raspberry Pi 4 Model B running QNX Neutrino RTOS 8.0",
  role: "Polls every turbine's sensors on a fixed real-time schedule and flags readings that cross a threshold before a fault develops.",
  specs: [
    ["Control loop", `${CONTROL_LOOP_HZ} Hz (${1000 / CONTROL_LOOP_HZ} ms deadline)`],
    ["Scheduling", "Priority-based preemptive, sensor thread at priority 50"],
    ["Interfaces", "I²C, 1-Wire, GPIO interrupts"],
    ["Power", "5 V USB-C, 3 A"],
  ],
};

export const TURBINE_PART = {
  title: "Wind turbine",
  hardware: "3-blade utility turbine with four sensors wired to the QNX base",
  role: "Responds to the simulator's weather, wakes from the other turbines, and its own condition. Click it to change that condition.",
  specs: [
    ["Rotor diameter", "120 m"],
    ["Cut-in / rated / cut-out", "3 / 12 / 25 m/s"],
    ["Trips offline at", "90% failure risk"],
  ],
};

export const SENSOR_PARTS = {
  vibration: {
    letter: "V",
    title: "Vibration sensor",
    hardware: "ADXL345 3-axis accelerometer",
    role: "Measures nacelle vibration. A rising trend is the earliest sign of bearing or blade imbalance.",
    specs: [
      ["Bus", "I²C at 400 kHz"],
      ["Sample rate", "100 Hz"],
      ["Range", "±4 g"],
    ],
    unit: "mm/s",
    key: "liveVibration",
    warn: 4.5,
  },
  temperature: {
    letter: "T",
    title: "Bearing temperature sensor",
    hardware: "DS18B20 digital thermometer",
    role: "Clamped to the main bearing housing. Heat build-up under steady load points to lubrication or wear problems.",
    specs: [
      ["Bus", "1-Wire"],
      ["Sample rate", "1 Hz"],
      ["Accuracy", "±0.5 °C"],
    ],
    unit: "°C",
    key: "liveBearingTemp",
    warn: 80,
  },
  rotor: {
    letter: "R",
    title: "Rotor speed sensor",
    hardware: "A3144 Hall-effect sensor with hub magnet",
    role: "Counts rotor revolutions. Speed that drops while the wind holds steady indicates drag or a failing generator.",
    specs: [
      ["Interface", "GPIO interrupt, one pulse per revolution"],
      ["Resolution", "1 RPM"],
    ],
    unit: "RPM",
    key: "rpm",
  },
  wind: {
    letter: "W",
    title: "Anemometer",
    hardware: "Cup anemometer with reed-switch pulse output",
    role: "Measures the air speed reaching the rotor, after any wake from upwind turbines, so output can be compared to what the wind should produce.",
    specs: [
      ["Interface", "GPIO pulse counter"],
      ["Sample rate", "1 Hz"],
    ],
    unit: "m/s",
    key: "effectiveWind",
  },
};

export const CABLE_PART = {
  title: "Sensor cable",
  hardware: "Shielded 4-conductor cable (power, ground, SDA, SCL)",
  role: "Carries power to the turbine's sensors and their readings back to the base. It stretches as you move the turbine.",
  specs: [["Shielding", "Foil, grounded at the base"]],
};

export const JUNCTION_PART = {
  title: "Bus junction",
  hardware: "TCA9548A I²C multiplexer channel",
  role: "Gives each turbine its own I²C channel so identical sensors on different turbines don't share an address.",
  specs: [["Channels", "8 (3 in use)"]],
};
