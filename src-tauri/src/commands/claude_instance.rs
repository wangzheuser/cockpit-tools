use std::path::Path;

use crate::models::claude::ClaudeAuthMode;
use crate::models::{DefaultInstanceSettings, InstanceProfileView};
use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";

fn is_profile_initialized(user_data_dir: &str) -> bool {
    modules::claude_instance::is_profile_initialized(Path::new(user_data_dir))
}

fn inject_bound_account_for_instance_start(
    user_data_dir: &str,
    bind_account_id: Option<&str>,
    backup_existing: bool,
) -> Result<(), String> {
    let bind_id = bind_account_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(bind_id) = bind_id else {
        return Ok(());
    };

    let account = modules::claude_account::load_account(bind_id)
        .ok_or_else(|| format!("绑定账号不存在: {}", bind_id))?;

    match account.auth_mode {
        ClaudeAuthMode::DesktopOAuth => modules::claude_account::restore_desktop_account_to_profile(
            bind_id,
            Path::new(user_data_dir),
            backup_existing,
        ),
        ClaudeAuthMode::ApiKey => Err(
            "Claude API Key 账号不能写入 Claude Desktop 登录态，请选择 Claude Desktop 登录账号或取消绑定。"
                .to_string(),
        ),
        _ => Err("旧 OAuth 账号已不再支持用于 Claude Desktop 实例，请重新添加 Claude Desktop 登录账号。"
            .to_string()),
    }
}

#[tauri::command]
pub async fn claude_get_instance_defaults() -> Result<modules::instance::InstanceDefaults, String> {
    modules::claude_instance::get_instance_defaults()
}

#[tauri::command]
pub async fn claude_list_instances() -> Result<Vec<InstanceProfileView>, String> {
    let store = modules::claude_instance::load_instance_store()?;
    let default_dir = modules::claude_instance::get_default_claude_config_dir()?;
    let default_dir_str = default_dir.to_string_lossy().to_string();
    let default_settings = store.default_settings.clone();
    let process_entries = modules::claude_instance::collect_claude_process_entries();

    let mut result: Vec<InstanceProfileView> = store
        .instances
        .into_iter()
        .map(|instance| {
            let resolved_pid = modules::claude_instance::resolve_claude_pid_from_entries(
                instance.last_pid,
                Some(&instance.user_data_dir),
                &process_entries,
            );
            let running = resolved_pid.is_some();
            let initialized = is_profile_initialized(&instance.user_data_dir);
            let mut view = InstanceProfileView::from_profile(instance, running, initialized);
            view.last_pid = resolved_pid;
            view
        })
        .collect();

    let default_pid = modules::claude_instance::resolve_claude_pid_from_entries(
        default_settings.last_pid,
        None,
        &process_entries,
    );
    let default_running = default_pid.is_some();
    result.push(InstanceProfileView {
        id: DEFAULT_INSTANCE_ID.to_string(),
        name: String::new(),
        user_data_dir: default_dir_str,
        working_dir: default_settings.working_dir.clone(),
        extra_args: default_settings.extra_args.clone(),
        bind_account_id: default_settings.bind_account_id.clone(),
        created_at: 0,
        last_launched_at: None,
        last_pid: default_pid,
        running: default_running,
        initialized: modules::claude_instance::is_profile_initialized(&default_dir),
        is_default: true,
        follow_local_account: false,
    });

    Ok(result)
}

#[tauri::command]
pub async fn claude_create_instance(
    name: String,
    user_data_dir: String,
    working_dir: Option<String>,
    extra_args: Option<String>,
    bind_account_id: Option<String>,
    copy_source_instance_id: Option<String>,
    init_mode: Option<String>,
) -> Result<InstanceProfileView, String> {
    let instance = modules::claude_instance::create_instance(
        modules::claude_instance::CreateInstanceParams {
            name,
            user_data_dir,
            working_dir,
            extra_args: extra_args.unwrap_or_default(),
            bind_account_id,
            copy_source_instance_id,
            init_mode,
        },
    )?;
    let initialized = is_profile_initialized(&instance.user_data_dir);
    Ok(InstanceProfileView::from_profile(
        instance,
        false,
        initialized,
    ))
}

#[tauri::command]
pub async fn claude_update_instance(
    instance_id: String,
    name: Option<String>,
    working_dir: Option<String>,
    extra_args: Option<String>,
    bind_account_id: Option<Option<String>>,
    follow_local_account: Option<bool>,
) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::claude_instance::get_default_claude_config_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let updated = modules::claude_instance::update_default_settings(
            bind_account_id,
            working_dir,
            extra_args,
            follow_local_account,
        )?;
        let resolved_pid = modules::claude_instance::resolve_claude_pid(updated.last_pid, None);
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            working_dir: updated.working_dir,
            extra_args: updated.extra_args,
            bind_account_id: updated.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: resolved_pid,
            running: resolved_pid.is_some(),
            initialized: modules::claude_instance::is_profile_initialized(&default_dir),
            is_default: true,
            follow_local_account: false,
        });
    }

    let instance = modules::claude_instance::update_instance(
        modules::claude_instance::UpdateInstanceParams {
            instance_id,
            name,
            working_dir,
            extra_args,
            bind_account_id,
        },
    )?;
    let resolved_pid = modules::claude_instance::resolve_claude_pid(
        instance.last_pid,
        Some(&instance.user_data_dir),
    );
    let initialized = is_profile_initialized(&instance.user_data_dir);
    let mut view = InstanceProfileView::from_profile(instance, resolved_pid.is_some(), initialized);
    view.last_pid = resolved_pid;
    Ok(view)
}

#[tauri::command]
pub async fn claude_delete_instance(instance_id: String) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        return Err("默认实例不可删除".to_string());
    }
    modules::claude_instance::delete_instance(&instance_id)
}

#[tauri::command]
pub async fn claude_start_instance(instance_id: String) -> Result<InstanceProfileView, String> {
    modules::logger::log_info(&format!("开始启动 Claude Desktop 实例: {}", instance_id));
    modules::claude_instance::ensure_claude_launch_path_configured()?;

    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::claude_instance::get_default_claude_config_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings = modules::claude_instance::load_default_settings()?;

        if let Some(pid) =
            modules::claude_instance::resolve_claude_pid(default_settings.last_pid, None)
        {
            modules::process::close_pid(pid, 20)?;
            let _ = modules::claude_instance::update_default_pid(None)?;
        }

        modules::claude_instance::close_claude(&[default_dir_str.clone()], 20)?;
        inject_bound_account_for_instance_start(
            &default_dir_str,
            default_settings.bind_account_id.as_deref(),
            true,
        )?;

        let extra_args = modules::process::parse_extra_args(&default_settings.extra_args);
        let pid = modules::claude_instance::start_claude_default_with_args_with_new_window(
            &extra_args,
            true,
        )?;
        let _ = modules::claude_instance::update_default_pid(Some(pid))?;
        let running = modules::claude_instance::resolve_claude_pid(Some(pid), None).is_some();
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            working_dir: default_settings.working_dir.clone(),
            extra_args: default_settings.extra_args.clone(),
            bind_account_id: default_settings.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: Some(pid),
            running,
            initialized: modules::claude_instance::is_profile_initialized(&default_dir),
            is_default: true,
            follow_local_account: false,
        });
    }

    let store = modules::claude_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    if let Some(pid) = modules::claude_instance::resolve_claude_pid(
        instance.last_pid,
        Some(&instance.user_data_dir),
    ) {
        modules::process::close_pid(pid, 20)?;
        let _ = modules::claude_instance::update_instance_pid(&instance.id, None)?;
    }

    modules::claude_instance::close_claude(&[instance.user_data_dir.clone()], 20)?;
    inject_bound_account_for_instance_start(
        &instance.user_data_dir,
        instance.bind_account_id.as_deref(),
        false,
    )?;

    let extra_args = modules::process::parse_extra_args(&instance.extra_args);
    let pid = modules::claude_instance::start_claude_with_args_with_new_window(
        &instance.user_data_dir,
        &extra_args,
        true,
    )?;
    let updated = modules::claude_instance::update_instance_after_start(&instance.id, pid)?;
    let running =
        modules::claude_instance::resolve_claude_pid(Some(pid), Some(&updated.user_data_dir))
            .is_some();
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(InstanceProfileView::from_profile(
        updated,
        running,
        initialized,
    ))
}

#[tauri::command]
pub async fn claude_stop_instance(instance_id: String) -> Result<InstanceProfileView, String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_dir = modules::claude_instance::get_default_claude_config_dir()?;
        let default_dir_str = default_dir.to_string_lossy().to_string();
        let default_settings = modules::claude_instance::load_default_settings()?;

        if let Some(pid) =
            modules::claude_instance::resolve_claude_pid(default_settings.last_pid, None)
        {
            modules::process::close_pid(pid, 20)?;
        }

        let updated_settings = modules::claude_instance::update_default_pid(None)?;
        let running = updated_settings
            .last_pid
            .and_then(|pid| modules::claude_instance::resolve_claude_pid(Some(pid), None))
            .is_some();
        return Ok(InstanceProfileView {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: String::new(),
            user_data_dir: default_dir_str,
            working_dir: default_settings.working_dir.clone(),
            extra_args: default_settings.extra_args.clone(),
            bind_account_id: default_settings.bind_account_id,
            created_at: 0,
            last_launched_at: None,
            last_pid: None,
            running,
            initialized: modules::claude_instance::is_profile_initialized(&default_dir),
            is_default: true,
            follow_local_account: false,
        });
    }

    let store = modules::claude_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    if let Some(pid) = modules::claude_instance::resolve_claude_pid(
        instance.last_pid,
        Some(&instance.user_data_dir),
    ) {
        modules::process::close_pid(pid, 20)?;
    }

    let updated = modules::claude_instance::update_instance_pid(&instance.id, None)?;
    let initialized = is_profile_initialized(&updated.user_data_dir);
    Ok(InstanceProfileView::from_profile(
        updated,
        false,
        initialized,
    ))
}

#[tauri::command]
pub async fn claude_open_instance_window(instance_id: String) -> Result<(), String> {
    if instance_id == DEFAULT_INSTANCE_ID {
        let default_settings: DefaultInstanceSettings =
            modules::claude_instance::load_default_settings()?;
        modules::claude_instance::focus_claude_instance(default_settings.last_pid, None)
            .map_err(|err| format!("定位 Claude 默认实例窗口失败: {}", err))?;
        return Ok(());
    }

    let store = modules::claude_instance::load_instance_store()?;
    let instance = store
        .instances
        .into_iter()
        .find(|item| item.id == instance_id)
        .ok_or("实例不存在")?;

    modules::claude_instance::focus_claude_instance(
        instance.last_pid,
        Some(&instance.user_data_dir),
    )
    .map_err(|err| {
        format!(
            "定位 Claude 实例窗口失败: instance_id={}, err={}",
            instance.id, err
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn claude_close_all_instances() -> Result<(), String> {
    let store = modules::claude_instance::load_instance_store()?;
    let default_dir = modules::claude_instance::get_default_claude_config_dir()?;

    let mut target_dirs = Vec::new();
    target_dirs.push(default_dir.to_string_lossy().to_string());
    for instance in &store.instances {
        let dir = instance.user_data_dir.trim();
        if !dir.is_empty() {
            target_dirs.push(dir.to_string());
        }
    }

    modules::claude_instance::close_claude(&target_dirs, 20)?;
    let _ = modules::claude_instance::clear_all_pids();
    Ok(())
}
