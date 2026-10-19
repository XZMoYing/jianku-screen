import { Button } from "@cap/ui-solid";
import type { ComponentProps } from "solid-js";
import { createSignInMutation } from "~/utils/auth";
import { t as localize } from "~/utils/i18n";

export function SignInButton(
	props: Omit<ComponentProps<typeof Button>, "onClick">,
) {
	const signIn = createSignInMutation();

	return (
		<Button
			size="md"
			class="flex grow justify-center items-center"
			{...props}
			variant={signIn.isPending ? "gray" : "primary"}
			onClick={() => {
				if (signIn.isPending) {
					signIn.variables.abort();
					signIn.reset();
				} else {
					signIn.mutate(new AbortController());
				}
			}}
		>
			{signIn.isPending
				? localize("Cancel Sign In")
				: (props.children ?? localize("敬请期待"))}
		</Button>
	);
}
