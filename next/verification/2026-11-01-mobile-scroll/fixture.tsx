import { createSignal, Suspense } from "solid-js";
import { render } from "solid-js/web";
import {
	MotionPanel,
	MotionSwitch,
} from "../../cap/apps/desktop/src/components/InterfaceMotion";

import MobileRecorder from "../../cap/apps/desktop/src/components/MobileRecorder";

function Fixture() {
	const [mode, setMode] = createSignal("recording");
	const [source, setSource] = createSignal("mobile");
	return (
		<>
			<nav>
				<button type="button" onClick={() => setMode("recording")}>
					Recording
				</button>
				<button type="button" onClick={() => setMode("presentation")}>
					Presentation
				</button>
				<button type="button" onClick={() => setSource("desktop")}>
					Desktop
				</button>
				<button type="button" onClick={() => setSource("mobile")}>
					Mobile
				</button>
			</nav>
			<div
				style={{
					height: "300px",
					display: "flex",
					"flex-direction": "column",
					overflow: "hidden",
				}}
			>
				<MotionSwitch value={mode()} kind="subpage">
					{(displayedMode) => (
						<>
							<MotionPanel visible={displayedMode() === "presentation"}>
								<div style={{ height: "180px" }}>Presentation content</div>
							</MotionPanel>
							<MotionPanel visible={displayedMode() === "recording"}>
								<MotionSwitch value={source()} kind="subpage">
									{(displayedSource) => (
										<>
											<MotionPanel visible={displayedSource() === "desktop"}>
												Desktop content
											</MotionPanel>
											<MotionPanel visible={displayedSource() === "mobile"}>
												<Suspense fallback={<div>Loading</div>}>
													<MobileRecorder
														visible={
															displayedMode() === "recording" &&
															displayedSource() === "mobile"
														}
														blocked={false}
														onActive={() => {}}
													/>
												</Suspense>
											</MotionPanel>
										</>
									)}
								</MotionSwitch>
							</MotionPanel>
						</>
					)}
				</MotionSwitch>
			</div>
		</>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("Expected fixture root");
render(() => <Fixture />, root);
