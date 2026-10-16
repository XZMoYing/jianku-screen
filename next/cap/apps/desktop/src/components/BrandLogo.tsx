import brandLogo from "~/assets/branding/logo.png";
import { t as localize } from "~/utils/i18n";

export default function BrandLogo(props: { class?: string }) {
	return (
		<img
			src={brandLogo}
			alt={localize("简库镜传")}
			class={props.class ?? "size-8"}
		/>
	);
}
