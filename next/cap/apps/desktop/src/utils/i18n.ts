import { createSignal } from "solid-js";
import en from "~/i18n/en.json";
import zh from "~/i18n/zh-CN.json";
import { languageStore } from "~/store";

export type InterfaceLanguage = "zh-CN" | "en" | "system";
const [preference, setPreference] = createSignal<InterfaceLanguage>("zh-CN");
export const interfaceLanguage = preference;
const [systemLanguage, setSystemLanguage] = createSignal(
	typeof navigator === "undefined" ? "zh-CN" : navigator.language,
);
export function resolveLanguage(
	language: InterfaceLanguage,
	system = "zh-CN",
): "zh-CN" | "en" {
	return language === "system"
		? system.toLowerCase().startsWith("zh")
			? "zh-CN"
			: "en"
		: language;
}
export const activeLanguage = () =>
	resolveLanguage(preference(), systemLanguage());
export function translate(text: string, language: "zh-CN" | "en") {
	const dictionary: Record<string, string> = language === "en" ? en : zh;
	return (
		typeof dictionary[text] === "string" ? dictionary[text] : text
	).replace(
		/\bCap\b/g,
		language === "en" ? "Jianku Screen Next" : "简库镜传 Next",
	);
}
export function t(text: string, values?: Record<string, string | number>) {
	const translated = translate(text, activeLanguage());
	return values
		? translated.replace(/\{(\w+)\}/g, (match, key: string) =>
				values[key] === undefined ? match : String(values[key]),
			)
		: translated;
}
let pending = Promise.resolve();
export async function setInterfaceLanguage(language: InterfaceLanguage) {
	setPreference(language);
	document.documentElement.lang = activeLanguage();
	pending = pending.catch(() => {}).then(() => languageStore.set({ language }));
	await pending;
}
export function installLanguage() {
	let disposed = false;
	let stop: (() => void) | undefined;
	const update = (language: InterfaceLanguage) => {
		setPreference(language);
		document.documentElement.lang = activeLanguage();
	};
	void languageStore
		.get()
		.then((settings) => {
			if (!disposed) update(settings?.language ?? "zh-CN");
		})
		.catch(console.error);
	void languageStore
		.listen((settings) => {
			if (!disposed) update(settings?.language ?? "zh-CN");
		})
		.then((unlisten) => {
			if (disposed) unlisten();
			else stop = unlisten;
		})
		.catch(console.error);
	const system = () => {
		setSystemLanguage(navigator.language);
		if (preference() === "system") update("system");
	};
	window.addEventListener("languagechange", system);
	return () => {
		disposed = true;
		stop?.();
		window.removeEventListener("languagechange", system);
	};
}
