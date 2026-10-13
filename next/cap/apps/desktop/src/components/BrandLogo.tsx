import brandLogo from "~/assets/branding/logo.png";

export default function BrandLogo(props: { class?: string }) {
	return <img src={brandLogo} alt="简库镜传" class={props.class ?? "size-8"} />;
}
