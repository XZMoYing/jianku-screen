export const t = (value: string) => value;
export const makePersisted = (state: unknown) => state;
export const revealItemInDir = async () => {};
export const ChoiceSelect = (props: { label?: string }) => (
	<select aria-label={props.label}>
		<option>Test</option>
	</select>
);
export const commands = {
	getMobileSetup: async () => {
		await new Promise((r) => setTimeout(r, 180));
		return {
			devices: [],
			warnings: [],
			androidReady: true,
			iosReady: true,
		};
	},
	getMobileStatus: async () => ({
		active: false,
		phase: "idle",
		elapsedSeconds: 0,
	}),
	listMobileProjects: async () => {
		await new Promise((r) => setTimeout(r, 220));
		return Array.from({ length: 8 }, (_, i) => ({
			path: `/synthetic/project-${i}.jks`,
			name: `Synthetic ${i}`,
			phase: "complete",
			hasSource: true,
		}));
	},
};
export default function Icon() {
	return <span aria-hidden="true">○</span>;
}
