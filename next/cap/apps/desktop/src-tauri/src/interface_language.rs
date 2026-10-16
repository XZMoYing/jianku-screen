use std::{collections::HashMap, sync::OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

pub fn english(app: &AppHandle) -> bool {
    let language = app
        .store("store")
        .ok()
        .and_then(|store| store.get("interface_language"))
        .and_then(|v| {
            v.get("language")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "zh-CN".into());
    language == "en"
        || language == "system"
            && tauri_plugin_os::locale()
                .is_some_and(|locale| !locale.to_ascii_lowercase().starts_with("zh"))
}
pub fn text(app: &AppHandle, text: &str) -> String {
    static ZH: OnceLock<HashMap<String, String>> = OnceLock::new();
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    let en = english(app);
    let dictionary = if en {
        EN.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/i18n/en.json"))
                .expect("Valid English translations")
        })
    } else {
        ZH.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/i18n/zh-CN.json"))
                .expect("Valid Chinese translations")
        })
    };
    static BRAND: OnceLock<regex::Regex> = OnceLock::new();
    BRAND
        .get_or_init(|| regex::Regex::new(r"\bCap\b").expect("Valid brand pattern"))
        .replace_all(
            dictionary.get(text).map_or(text, String::as_str),
            if en {
                "Jianku Screen Next"
            } else {
                "简库镜传 Next"
            },
        )
        .into_owned()
}

pub fn refresh(app: &AppHandle) {
    crate::tray::refresh_tray_menu_for_app(app);
    for (label, window) in app.webview_windows() {
        if let Ok(id) = label.parse::<crate::windows::CapWindowId>() {
            let _ = window.set_title(&text(app, &id.title()));
        }
    }
}
