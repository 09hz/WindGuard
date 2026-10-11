// Catalog of the physical QNX test rig shown in the simulator's hardware zone.
// PLACEHOLDER SPECS: replace the names and numbers below with the team's real
// parts. The hover cards read everything from here, so no UI changes are needed.

export const QNX_ZONE = { x: 2440, width: 760 }; // metres within the site map
export const QNX_BASE = { x: 3060, y: 700, width: 190, height: 330 };
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
  title: "Bench model turbine",
  hardware: "3-blade model turbine with 12 V DC generator",
  role: "A physical turbine on the bench. It is driven by a fixed fan, so the simulator's weather controls do not affect it.",
  specs: [
    ["Rotor diameter", "30 cm"],
    ["Rated output", "5 W at 12 V"],
    ["Drive", "Desk fan at constant speed"],
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
    key: "vibration",
    warn: 4.5,
  },
  temperature: {
    letter: "T",
    title: "Bearing temperature sensor",
    hardware: "DS18B20 digital thermometer",
    role: "Clamped to the generator bearing housing. Heat build-up under steady load points to lubrication or wear problems.",
    specs: [
      ["Bus", "1-Wire"],
      ["Sample rate", "1 Hz"],
      ["Accuracy", "±0.5 °C"],
    ],
    unit: "°C",
    key: "bearingTemp",
    warn: 45,
  },
  rotor: {
    letter: "R",
    title: "Rotor speed sensor",
    hardware: "A3144 Hall-effect sensor with hub magnet",
    role: "Counts rotor revolutions. Speed that drops while the fan is constant indicates drag or a failing generator.",
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
    role: "Measures the air speed reaching the rotor, so output can be compared to what the wind should produce.",
    specs: [
      ["Interface", "GPIO pulse counter"],
      ["Sample rate", "1 Hz"],
    ],
    unit: "m/s",
    key: "wind",
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
