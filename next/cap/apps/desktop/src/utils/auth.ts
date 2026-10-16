import { createMutation } from "@tanstack/solid-query";
import toast from "solid-toast";
import { t } from "./i18n";

export function showAccountComingSoon() {
	toast(t("账号功能敬请期待，本地录制和编辑可正常使用。"));
}

export function createSignInMutation() {
	return createMutation(() => ({
		mutationFn: async (_abort: AbortController) => showAccountComingSoon(),
	}));
}
