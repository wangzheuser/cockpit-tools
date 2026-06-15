import { useTranslation } from 'react-i18next';
import { PlatformInstancesContent } from '../components/platform/PlatformInstancesContent';
import { usePlatformRuntimeSupport } from '../hooks/usePlatformRuntimeSupport';
import { useClaudeAccountStore } from '../stores/useClaudeAccountStore';
import { useClaudeInstanceStore } from '../stores/useClaudeInstanceStore';
import type { ClaudeAccount } from '../types/claude';
import {
  formatClaudeResetTime,
  getClaudeAccountDisplayEmail,
  getClaudePlanBadge,
  getClaudePlanBadgeClass,
  getClaudeQuotaClass,
} from '../types/claude';

interface ClaudeInstancesContentProps {
  accountsForSelect?: ClaudeAccount[];
}

function renderClaudeQuotaPreview(
  account: ClaudeAccount,
  emptyText: string,
  apiKeyText: string,
  currentSessionLabel: string,
  currentWeekLabel: string,
) {
  if (account.auth_mode === 'api_key') {
    return <span className="account-quota-empty">{apiKeyText}</span>;
  }

  const quota = account.quota;
  if (!quota) {
    return <span className="account-quota-empty">{emptyText}</span>;
  }

  const rows = [
    {
      key: 'five-hour',
      label: currentSessionLabel,
      value: quota.five_hour_percentage,
      reset: quota.five_hour_reset_time,
    },
    {
      key: 'seven-day',
      label: currentWeekLabel,
      value: quota.seven_day_percentage,
      reset: quota.seven_day_reset_time,
    },
  ];

  return (
    <div className="account-quota-preview">
      {rows.map((row) => {
        const quotaClass = getClaudeQuotaClass(row.value);
        const resetText = formatClaudeResetTime(row.reset);
        return (
          <span className="account-quota-item" key={row.key} title={resetText}>
            <span className={`quota-dot ${quotaClass}`} />
            <span className={`quota-text ${quotaClass}`}>
              {row.label} {row.value}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function ClaudeInstancesContent({
  accountsForSelect,
}: ClaudeInstancesContentProps = {}) {
  const { t } = useTranslation();
  const instanceStore = useClaudeInstanceStore();
  const { accounts: storeAccounts, fetchAccounts } = useClaudeAccountStore();
  const accounts = accountsForSelect ?? storeAccounts;
  const isSupportedPlatform = usePlatformRuntimeSupport('desktop');

  return (
    <PlatformInstancesContent<ClaudeAccount>
      instanceStore={instanceStore}
      accounts={accounts}
      fetchAccounts={fetchAccounts}
      renderAccountQuotaPreview={(account) =>
        renderClaudeQuotaPreview(
          account,
          t('instances.quota.empty', '暂无配额缓存'),
          t('claude.apiKey.quotaUnsupported', 'API Key 账号不支持 Claude 订阅配额刷新'),
          t('claude.quota.fiveHour', 'Current session'),
          t('claude.quota.sevenDay', 'Current week (all models)'),
        )
      }
      renderAccountBadge={(account) => (
        <span className={`instance-plan-badge ${getClaudePlanBadgeClass(account)}`}>
          {getClaudePlanBadge(account) || t('claude.desktopOAuth.planUnknown', '订阅未知')}
        </span>
      )}
      getAccountSearchText={(account) =>
        `${getClaudeAccountDisplayEmail(account)} ${getClaudePlanBadge(account)} ${account.organization_name ?? ''}`
      }
      appType="claude"
      isSupported={isSupportedPlatform}
      unsupportedTitleKey="common.shared.instances.unsupported.title"
      unsupportedTitleDefault="暂不支持当前系统"
      unsupportedDescKey="claude.instances.unsupportedDescPlatform"
      unsupportedDescDefault="Claude Desktop 多开实例仅支持 macOS、Windows 和 Linux。"
      resolveStartSuccessMessage={() =>
        t('claude.instances.startSuccess', 'Claude Desktop 已启动')
      }
    />
  );
}

export function ClaudeInstancesPage() {
  return <ClaudeInstancesContent />;
}
