import brandLogo from "~/assets/branding/logo.png";
export function AbsoluteInsetLoader() {
	return (
		<div class="w-full h-full flex items-center justify-center">
			<div class="animate-spin">
				<img src={brandLogo} alt="简库镜传" class="size-16 rounded-xl" />
			</div>
		</div>
	);
}
