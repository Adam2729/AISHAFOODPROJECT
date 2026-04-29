/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("child_process");

const GROUPS = [
  {
    name: "Core ordering",
    commands: [
      "npm run qa:smoke:user-profile",
      "npm run qa:smoke:phase6-ordering",
      "npm run qa:smoke:delivery-otp",
    ],
  },
  {
    name: "Dispatch",
    commands: [
      "npm run qa:smoke:phase4-dispatch",
      "npm run qa:smoke:phase5-dispatch",
      "npm run qa:smoke:dispatch",
      "npm run qa:smoke:phase3-driverweb",
      "npm run qa:smoke:phase3-driver-dashboard",
    ],
  },
  {
    name: "Payments",
    commands: [
      "npm run qa:smoke:phase7-payments",
      "npm run qa:smoke:driver-cash",
      "npm run qa:smoke:finance-align",
    ],
  },
  {
    name: "Growth and loyalty",
    commands: [
      "npm run qa:smoke:phase8-growth",
      "npm run qa:smoke:phase11-loyalty",
    ],
  },
  {
    name: "Ads and analytics",
    commands: [
      "npm run qa:smoke:phase12-ads",
      "npm run qa:smoke:phase9-analytics",
      "npm run qa:smoke:phase3-analytics-ops",
    ],
  },
  {
    name: "Onboarding and incentives",
    commands: [
      "npm run qa:smoke:phase4-merchant",
      "npm run qa:smoke:phase4-driver",
      "npm run qa:smoke:phase10-incentives",
    ],
  },
];

function printPlan() {
  console.log("Aisha Food DR pilot smoke plan");
  console.log("");
  for (const group of GROUPS) {
    console.log(`${group.name}:`);
    for (const command of group.commands) {
      console.log(`  - ${command}`);
    }
    console.log("");
  }
  console.log("Use --run to execute the plan in sequence.");
}

function runPlan() {
  for (const group of GROUPS) {
    console.log(`\n=== ${group.name} ===`);
    for (const command of group.commands) {
      console.log(`\n> ${command}`);
      const result = spawnSync(command, {
        stdio: "inherit",
        shell: true,
      });
      if (result.status !== 0) {
        process.exit(result.status || 1);
      }
    }
  }
}

if (process.argv.includes("--run")) {
  runPlan();
} else {
  printPlan();
}
