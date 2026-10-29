import { Button } from "@cap/ui-solid";
import { createWritableMemo } from "@solid-primitives/memo";
import { useMutation } from "@tanstack/solid-query";
import { createResource, Show, Suspense } from "solid-js";
import BrandLogo from "~/components/BrandLogo";
import { ChoiceSelect } from "~/components/ChoiceSelect";
import { Input } from "~/routes/editor/ui";
import { t as localize } from "~/utils/i18n";
import { createSelectedOrganization } from "~/utils/organization-branding";
import { commands } from "~/utils/tauri";
import { apiClient, protectedHeaders } from "~/utils/web-api";
import { Section, SectionCard, SettingsPageContent } from "../Setting";
import { IntegrationConfigHeader } from "./config-header";

interface S3Config {
	provider: string;
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	bucketName: string;
	region: string;
}

const DEFAULT_CONFIG = {
	provider: "aws",
	accessKeyId: "",
	secretAccessKey: "",
	endpoint: "https://s3.amazonaws.com",
	bucketName: "",
	region: "us-east-1",
};

export default function S3ConfigPage() {
	const organizationSelection = createSelectedOrganization();
	const [_s3Config, { refetch }] = createResource(
		() => organizationSelection.selectedOrganizationId(),
		async (orgId) => {
			const response = await apiClient.desktop.getS3Config({
				query: orgId ? { orgId } : undefined,
				headers: await protectedHeaders(),
			});

			if (response.status !== 200) throw new Error("Failed to fetch S3 config");

			return response.body;
		},
	);

	const managedByOrganization = () =>
		_s3Config()?.managedByOrganization ?? null;
	const hasConfig = () =>
		_s3Config()?.source === "user" && !!_s3Config()?.config.accessKeyId;

	const saveConfig = useMutation(() => ({
		mutationFn: async (config: S3Config) => {
			const response = await apiClient.desktop.setS3Config({
				body: config,
				headers: await protectedHeaders(),
			});

			if (response.status !== 200) throw new Error("Failed to save S3 config");
			return response;
		},
		onSuccess: async () => {
			await refetch();
			await commands.globalMessageDialog("S3 configuration saved successfully");
		},
	}));

	const deleteConfig = useMutation(() => ({
		mutationFn: async () => {
			const response = await apiClient.desktop.deleteS3Config({
				headers: await protectedHeaders(),
			});

			if (response.status !== 200)
				throw new Error("Failed to delete S3 config");
			return response;
		},
		onSuccess: async () => {
			await refetch();
			await commands.globalMessageDialog(
				"S3 configuration deleted successfully",
			);
		},
	}));

	const testConfig = useMutation(() => ({
		mutationFn: async (config: S3Config) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5500);

			try {
				const response = await apiClient.desktop.testS3Config({
					body: config,
					headers: await protectedHeaders(),
					fetchOptions: { signal: controller.signal },
				});

				clearTimeout(timeoutId);

				if (response.status !== 200)
					throw new Error(
						`S3 connection test failed. Check your config and network connection.`,
					);

				return response;
			} catch (error) {
				clearTimeout(timeoutId);

				if (error instanceof Error) {
					if (error.name === "AbortError")
						throw new Error(
							"Connection test timed out after 5 seconds. Please check your endpoint URL and network connection.",
						);
				}

				throw error;
			}
		},
		onSuccess: async () => {
			await commands.globalMessageDialog(
				"S3 configuration test successful! Connection is working.",
			);
		},
	}));

	const [s3Config, setS3Config] = createWritableMemo(
		() => _s3Config.latest?.config ?? DEFAULT_CONFIG,
	);

	const renderInput = (
		label: string,
		key: keyof ReturnType<typeof s3Config>,
		placeholder: string,
		type: "text" | "password" = "text",
	) => (
		<div class="space-y-2">
			<label class="text-[13px] text-gray-12">{label}</label>
			<Input
				class="bg-gray-3!"
				type={type}
				value={s3Config()[key] ?? ""}
				disabled={!!managedByOrganization()}
				onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
					setS3Config({
						...s3Config(),
						[key]: e.currentTarget.value,
					})
				}
				placeholder={placeholder}
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck={false}
			/>
		</div>
	);

	return (
		<div class="cap-settings-page flex flex-col h-full custom-scroll">
			<SettingsPageContent>
				<IntegrationConfigHeader title={localize("S3 Config")} />
				<Section
					title={localize("Configuration")}
					description={localize("按提示填写并连接存储空间。配置指南敬请期待。")}
				>
					<SectionCard padded class="custom-scroll">
						<Suspense
							fallback={
								<div class="flex justify-center items-center w-full h-screen">
									<BrandLogo class="animate-spin size-16" />
								</div>
							}
						>
							<div class="space-y-4 animate-in fade-in">
								<Show when={managedByOrganization()}>
									{(organization) => (
										<p class="text-xs leading-relaxed text-gray-10">
											{localize("Managed by your organization:")}{" "}
											{organization().name}
										</p>
									)}
								</Show>

								<div class="space-y-2">
									<label class="text-[13px] text-gray-12">
										{localize("Storage Provider")}
									</label>
									<div class="relative">
										<ChoiceSelect
											value={s3Config().provider}
											disabled={!!managedByOrganization()}
											onChange={(choiceValue) =>
												setS3Config((c) => ({
													...c,
													provider: choiceValue,
												}))
											}
											class="px-3 py-2 pr-10 w-full rounded-lg border border-transparent transition-all duration-200 appearance-none outline-hidden bg-gray-3 focus:border-gray-8"
											options={[
												{ value: "aws", label: "AWS S3" },
												{ value: "cloudflare", label: "Cloudflare R2" },
												{ value: "supabase", label: "Supabase" },
												{ value: "minio", label: "MinIO" },
												{
													value: "other",
													label: localize("Other S3-Compatible"),
												},
											]}
										/>
									</div>
								</div>

								{renderInput(
									"Access Key ID",
									"accessKeyId",
									"PL31OADSQNK",
									"password",
								)}
								{renderInput(
									"Secret Access Key",
									"secretAccessKey",
									"PL31OADSQNK",
									"password",
								)}
								{renderInput(
									"Endpoint",
									"endpoint",
									"https://s3.amazonaws.com",
								)}
								{renderInput("Bucket Name", "bucketName", "my-bucket")}
								{renderInput("Region", "region", "us-east-1")}
							</div>
						</Suspense>
					</SectionCard>
				</Section>
				<div class="shrink-0">
					<fieldset
						class="flex justify-between items-center"
						disabled={
							_s3Config.loading ||
							saveConfig.isPending ||
							deleteConfig.isPending ||
							testConfig.isPending ||
							!!managedByOrganization()
						}
					>
						<div class="flex gap-2">
							{!_s3Config.loading && hasConfig() && (
								<Button
									variant="destructive"
									onClick={() => deleteConfig.mutate()}
								>
									{deleteConfig.isPending ? "Removing..." : "Remove Config"}
								</Button>
							)}
							<Button
								variant="gray"
								onClick={() => testConfig.mutate(s3Config())}
							>
								{testConfig.isPending ? "Testing..." : "Test Connection"}
							</Button>
						</div>
						<Button
							class="min-w-[72px]"
							variant="primary"
							onClick={() => saveConfig.mutate(s3Config())}
						>
							{saveConfig.isPending ? localize("Saving...") : localize("Save")}
						</Button>
					</fieldset>
				</div>
			</SettingsPageContent>
		</div>
	);
}
