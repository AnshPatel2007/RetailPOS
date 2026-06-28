import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Settings,
  Shield,
  Database,
  Mail,
  Bell,
  Globe,
  Lock,
  Save,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

export const AdminSettings: React.FC = () => {
  // System Settings
  const [systemSettings, setSystemSettings] = useState({
    systemName: 'POS System',
    supportEmail: 'support@possystem.com',
    maxLoginAttempts: '5',
    sessionTimeout: '30',
    maintenanceMode: false,
  });

  // Security Settings
  const [securitySettings, setSecuritySettings] = useState({
    requireStrongPassword: true,
    passwordExpireDays: '90',
    twoFactorEnabled: false,
    allowRememberMe: true,
    maxConcurrentSessions: '3',
  });

  // Notification Settings
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    lowStockAlerts: true,
    dailyReports: true,
    weeklyReports: true,
    alertThreshold: '10',
  });

  // Backup Settings
  const [backupSettings, setBackupSettings] = useState({
    autoBackup: true,
    backupFrequency: 'daily',
    retentionDays: '30',
    lastBackup: '2024-01-15 03:00:00',
  });

  const saveSystemSettings = () => {
    // TODO: Call API to save system settings
    localStorage.setItem('admin_system_settings', JSON.stringify(systemSettings));
    toast.success('System settings saved');
  };

  const saveSecuritySettings = () => {
    // TODO: Call API to save security settings
    localStorage.setItem('admin_security_settings', JSON.stringify(securitySettings));
    toast.success('Security settings saved');
  };

  const saveNotificationSettings = () => {
    // TODO: Call API to save notification settings
    localStorage.setItem('admin_notification_settings', JSON.stringify(notificationSettings));
    toast.success('Notification settings saved');
  };

  const saveBackupSettings = () => {
    // TODO: Call API to save backup settings
    localStorage.setItem('admin_backup_settings', JSON.stringify(backupSettings));
    toast.success('Backup settings saved');
  };

  const triggerBackup = () => {
    // TODO: Call API to trigger manual backup
    toast.success('Backup initiated. This may take a few minutes.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">System Settings</h1>
        <p className="text-muted-foreground">
          Configure system-wide settings and preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              General Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="System Name"
              value={systemSettings.systemName}
              onChange={(e) =>
                setSystemSettings({ ...systemSettings, systemName: e.target.value })
              }
            />
            <Input
              label="Support Email"
              type="email"
              value={systemSettings.supportEmail}
              onChange={(e) =>
                setSystemSettings({ ...systemSettings, supportEmail: e.target.value })
              }
            />
            <Input
              label="Max Login Attempts"
              type="number"
              value={systemSettings.maxLoginAttempts}
              onChange={(e) =>
                setSystemSettings({ ...systemSettings, maxLoginAttempts: e.target.value })
              }
            />
            <Input
              label="Session Timeout (minutes)"
              type="number"
              value={systemSettings.sessionTimeout}
              onChange={(e) =>
                setSystemSettings({ ...systemSettings, sessionTimeout: e.target.value })
              }
            />
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={systemSettings.maintenanceMode}
                onChange={(e) =>
                  setSystemSettings({ ...systemSettings, maintenanceMode: e.target.checked })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Maintenance Mode</span>
            </label>
            <Button onClick={saveSystemSettings} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save General Settings
            </Button>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={securitySettings.requireStrongPassword}
                onChange={(e) =>
                  setSecuritySettings({
                    ...securitySettings,
                    requireStrongPassword: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Require Strong Passwords</span>
            </label>
            <Input
              label="Password Expiration (days)"
              type="number"
              value={securitySettings.passwordExpireDays}
              onChange={(e) =>
                setSecuritySettings({
                  ...securitySettings,
                  passwordExpireDays: e.target.value,
                })
              }
            />
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={securitySettings.twoFactorEnabled}
                onChange={(e) =>
                  setSecuritySettings({
                    ...securitySettings,
                    twoFactorEnabled: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Enable Two-Factor Authentication</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={securitySettings.allowRememberMe}
                onChange={(e) =>
                  setSecuritySettings({
                    ...securitySettings,
                    allowRememberMe: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Allow "Remember Me" Option</span>
            </label>
            <Input
              label="Max Concurrent Sessions"
              type="number"
              value={securitySettings.maxConcurrentSessions}
              onChange={(e) =>
                setSecuritySettings({
                  ...securitySettings,
                  maxConcurrentSessions: e.target.value,
                })
              }
            />
            <Button onClick={saveSecuritySettings} className="w-full">
              <Lock className="h-4 w-4 mr-2" />
              Save Security Settings
            </Button>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.emailNotifications}
                onChange={(e) =>
                  setNotificationSettings({
                    ...notificationSettings,
                    emailNotifications: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Email Notifications</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.lowStockAlerts}
                onChange={(e) =>
                  setNotificationSettings({
                    ...notificationSettings,
                    lowStockAlerts: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Low Stock Alerts</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.dailyReports}
                onChange={(e) =>
                  setNotificationSettings({
                    ...notificationSettings,
                    dailyReports: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Daily Reports</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.weeklyReports}
                onChange={(e) =>
                  setNotificationSettings({
                    ...notificationSettings,
                    weeklyReports: e.target.checked,
                  })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Weekly Reports</span>
            </label>
            <Input
              label="Low Stock Alert Threshold"
              type="number"
              value={notificationSettings.alertThreshold}
              onChange={(e) =>
                setNotificationSettings({
                  ...notificationSettings,
                  alertThreshold: e.target.value,
                })
              }
            />
            <Button onClick={saveNotificationSettings} className="w-full">
              <Mail className="h-4 w-4 mr-2" />
              Save Notification Settings
            </Button>
          </CardContent>
        </Card>

        {/* Backup Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Backup Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={backupSettings.autoBackup}
                onChange={(e) =>
                  setBackupSettings({ ...backupSettings, autoBackup: e.target.checked })
                }
                className="rounded border-input"
              />
              <span className="text-sm">Automatic Backups</span>
            </label>
            <div>
              <label className="block text-sm font-medium mb-1">Backup Frequency</label>
              <select
                value={backupSettings.backupFrequency}
                onChange={(e) =>
                  setBackupSettings({ ...backupSettings, backupFrequency: e.target.value })
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <Input
              label="Retention Period (days)"
              type="number"
              value={backupSettings.retentionDays}
              onChange={(e) =>
                setBackupSettings({ ...backupSettings, retentionDays: e.target.value })
              }
            />
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">
                Last Backup: {backupSettings.lastBackup}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveBackupSettings} className="flex-1">
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              <Button variant="outline" onClick={triggerBackup} className="flex-1">
                <RefreshCw className="h-4 w-4 mr-2" />
                Backup Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium">Reset All Settings</p>
              <p className="text-sm text-muted-foreground">
                Reset all system settings to default values
              </p>
            </div>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => {
                if (confirm('Are you sure you want to reset all settings?')) {
                  toast.success('Settings reset to defaults');
                }
              }}
            >
              Reset Settings
            </Button>
          </div>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium">Clear All Data</p>
              <p className="text-sm text-muted-foreground">
                Permanently delete all data from the system
              </p>
            </div>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => {
                toast.error('This action is disabled for safety');
              }}
            >
              Clear Data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
