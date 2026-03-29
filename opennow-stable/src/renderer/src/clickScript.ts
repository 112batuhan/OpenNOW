import { Dispatch, RefObject, SetStateAction } from "react";
import { GfnWebRtcClient } from "./gfn/webrtcClient";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickLoop(
  clientRef: RefObject<GfnWebRtcClient | null>,
  duration: number,
  interval: number,
) {
  const start = Date.now();

  while (Date.now() - start < duration) {
    clientRef.current?.sendMouseClick();
    await sleep(interval);
  }
}

async function moveCursorToCoordinates(
  clientRef: RefObject<GfnWebRtcClient | null>,
  x: number,
  y: number,
) {
  clientRef.current?.sendMouseMovement(-10000, -10000); // reseting mouse pos
  await sleep(150);
  clientRef.current?.sendMouseMovement(x, y);
}

// Maybe include ocr sometime?
// This seems to be consistent enough though
export async function ServerLoginScript(
  clientRef: RefObject<GfnWebRtcClient | null>,
  setDebugState: Dispatch<SetStateAction<string | null>>,
) {
  setDebugState("Waiting for Epic Games to Load");
  await sleep(20 * 1000);

  setDebugState("Opening Store");
  await moveCursorToCoordinates(clientRef, 230, 180);
  await sleep(150);
  clientRef.current?.sendMouseClick();

  setDebugState("Waiting for store to load");
  await sleep(20 * 1000);

  setDebugState("Clicking on Hell Let Loose on left");
  await moveCursorToCoordinates(clientRef, 225, 487);
  await sleep(150);
  await clickLoop(clientRef, 5000, 1000);

  setDebugState("Waiting for game to launch for 90 seconds");
  await moveCursorToCoordinates(clientRef, 10, 10);
  await clickLoop(clientRef, 90 * 1000, 3000);

  setDebugState("Clicking on Enlist");
  await moveCursorToCoordinates(clientRef, 81, 307);
  await sleep(150);
  clientRef.current?.sendMouseClick();

  setDebugState("Waiting for server browser to load");
  await sleep(5 * 1000);

  setDebugState("Click on search box");
  await moveCursorToCoordinates(clientRef, 650, 135);
  await sleep(150);
  clientRef.current?.sendMouseClick();

  const serverName = "turksletloose.com";
  setDebugState("Inputting " + serverName);
  await sleep(2000);
  clientRef.current?.sendText(serverName);

  setDebugState("Waiting for server browser to load");
  await sleep(20 * 1000);

  setDebugState("Spamming click on the first server");
  await moveCursorToCoordinates(clientRef, 170, 180);
  await sleep(150);
  await clickLoop(clientRef, 2 * 1000, 100);

  setDebugState("Waiting to log into the server");
  await sleep(20 * 1000);

  const left_x = 300; // left team logo middle
  const right_x = 900; // right team logo middle

  // Getting a random team to join first to keep bots balanced in both teams
  const first_try_x = Math.random() > 0.5 ? left_x : right_x;
  const second_try_x = first_try_x === left_x ? right_x : left_x;

  setDebugState("Joining a team: Trying the first option x: " + first_try_x);
  await moveCursorToCoordinates(clientRef, first_try_x, 400);
  await sleep(150);
  await clickLoop(clientRef, 2 * 5000, 1000);

  setDebugState("Joining a team: Trying the second option " + second_try_x);
  await moveCursorToCoordinates(clientRef, second_try_x, 400);
  await sleep(150);
  await clickLoop(clientRef, 2 * 5000, 1000);

  // Retrying the logins to avoid bots gettin stuck in team select
  setDebugState(
    "Joining a team: Trying the first option again x: " + first_try_x,
  );
  await moveCursorToCoordinates(clientRef, first_try_x, 400);
  await sleep(150);
  await clickLoop(clientRef, 2 * 5000, 1000);

  setDebugState(
    "Joining a team: Trying the second option again " + second_try_x,
  );
  await moveCursorToCoordinates(clientRef, second_try_x, 400);
  await sleep(150);
  await clickLoop(clientRef, 2 * 5000, 1000);

  setDebugState("Done");
}
