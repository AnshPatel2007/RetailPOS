import { Select } from '@/components/ui/Select';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import { PageTabs } from '@/components/common/PageTabs';
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/authStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import {
  Store,
  Receipt,
  CreditCard,
  Bell,
  Scan,
  Printer,
  DollarSign,
  TestTube2,
  Save
} from 'lucide-react';
import { hardware, HardwareSettings } from '@/services/hardware';
import { userService } from '@/services/api';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { PricingRulesCard } from '@/components/settings/PricingRulesCard';
import {SecurityNotifications} from '@/components/settings/SecurityNotifications';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import toast from 'react-hot-toast';
import { can } from '@/lib/capabilities';
import { useUrlFilter } from '@/hooks/useUrlFilter';

export const Settings: React.FC = () => {
  const { user } = useAuthStore();
  const settingsStore = useStoreSettingsStore();
  const [hardwareSettings, setHardwareSettings] = useState<HardwareSettings>(
    hardware.getSettings()
  );
  const [scannerTestResult, setScannerTestResult] = useState<string>('');

  const { isReadOnly, locationId, isSuperAdmin } = useEffectiveLocation();
  const canOperate = can(user?.role, 'settings.operational') && !isReadOnly;
  const canFinance = can(user?.role, 'settings.financial') && !isReadOnly;
  const isAdmin = !!locationId && (canOperate || isSuperAdmin);
  const [section, setSection] = useUrlFilter('section', 'profile', false);
  const sections = [{ id: 'profile', label: 'Profile & Security' },
    ...(isAdmin ? [{ id: 'store', label: 'Store' }, ...(canFinance || isSuperAdmin ? [{ id: 'payments', label: 'Taxes & Payments' }] : []), { id: 'receipts', label: 'Receipts' }, { id: 'pricing', label: 'Pricing' }, { id: 'notifications', label: 'Notifications' }] : []),
    { id: 'devices', label: 'Devices' }];
  const selected = sections.some(view => view.id === section) ? section : 'profile';
  const dirty = useRef<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const editable = canOperate && settingsStore.isLoaded && !settingsStore.error && !saving;


  // Local form state initialized from the Zustand store
  const [storeSettings, setStoreSettings] = useState(settingsStore.storeInfo);
  const [receiptSettings, setReceiptSettings] = useState(settingsStore.receiptSettings);
  const [paymentMethods, setPaymentMethods] = useState(settingsStore.paymentMethods);
  const [notificationSettings, setNotificationSettings] = useState(settingsStore.notificationSettings);

  // Fetch settings from backend on mount (syncs across users)
  useEffect(() => {
    if (locationId) settingsStore.fetchSettings(locationId);
  }, [locationId]);

  // Sync local form state when store settings update from backend
  useEffect(() => {
    if (!dirty.current.store && !dirty.current.payments) setStoreSettings(settingsStore.storeInfo);
    if (!dirty.current.receipts) setReceiptSettings(settingsStore.receiptSettings);
    if (!dirty.current.payments) setPaymentMethods(settingsStore.paymentMethods);
    if (!dirty.current.notifications) setNotificationSettings(settingsStore.notificationSettings);
  }, [settingsStore.storeInfo, settingsStore.receiptSettings, settingsStore.paymentMethods, settingsStore.notificationSettings]);

  // User profile state
  const [profileSettings, setProfileSettings] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Update profile state when user changes
  useEffect(() => {
    if (user) {
      setProfileSettings(prev => ({
        ...prev,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
      }));
    }
  }, [user]);

  const saveSection = async (view: string, operation: () => Promise<void>) => {
    if (!editable || (view === 'payments' && !canFinance)) return;
    setSaving(true);
    try { await operation(); dirty.current[view] = false; toast.success('Settings saved'); }
    catch (error: any) { toast.error(error.response?.data?.error || error.message || 'Failed to save settings'); }
    finally { setSaving(false); }
  };
  const saveStoreSettings = () => saveSection('store', () => settingsStore.saveStoreInfo({ storeName: storeSettings.storeName, address: storeSettings.address, city: storeSettings.city, state: storeSettings.state, phone: storeSettings.phone }));
  const saveReceiptSettings = () => saveSection('receipts', () => settingsStore.saveReceiptSettings(receiptSettings));
  const savePaymentMethods = () => saveSection('payments', () => settingsStore.savePaymentMethods(paymentMethods));
  const saveTaxSettings = () => saveSection('payments', () => settingsStore.saveTaxRate(storeSettings.taxRate || 0));
  const saveNotificationSettings = () => saveSection('notifications', () => settingsStore.saveNotificationSettings(notificationSettings));

  const saveUserProfile = async () => {
    // Validate password fields before making any API calls
    if (profileSettings.newPassword) {
      if (!profileSettings.currentPassword) {
        toast.error('Current password is required to change password');
        return;
      }
      if (profileSettings.newPassword !== profileSettings.confirmPassword) {
        toast.error('New passwords do not match');
        return;
      }
    }

    try {
      // Update profile (name and email)
      const response = await userService.updateProfile({
        firstName: profileSettings.firstName,
        lastName: profileSettings.lastName,
        email: profileSettings.email,
      });

      // Update auth store with new user data
      useAuthStore.setState({ user: response.data.data });

      // If password change is requested, handle separately
      if (profileSettings.newPassword) {
        await userService.changePassword({
          currentPassword: profileSettings.currentPassword,
          newPassword: profileSettings.newPassword,
          confirmPassword: profileSettings.confirmPassword,
        });

        setProfileSettings(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
        await useAuthStore.getState().logout();
        toast.success('Password updated. Sign in again with your new password.');
      } else {
        toast.success('Profile updated successfully');
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || 'Failed to update profile';
      toast.error(errorMessage);
    }
  };

  // Listen for barcode scans when in test mode
  useEffect(() => {
    if (scannerTestResult) {
      const handleScan = (barcode: string) => {
        setScannerTestResult(`Scanned: ${barcode}`);
        toast.success(`Barcode detected: ${barcode}`);
      };
      hardware.scanner.onScan(handleScan);
      return () => hardware.scanner.offScan(handleScan);
    }
  }, [scannerTestResult]);

  // Handle hardware settings change
  const updateHardwareSettings = (
    section: keyof HardwareSettings,
    field: string,
    value: any
  ) => {
    setHardwareSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  // Save hardware settings
  const saveHardwareSettings = () => {
    if (!canOperate) return;
    try { hardware.saveSettings(hardwareSettings); toast.success('Device settings saved for this browser/register'); }
    catch { toast.error('This browser could not save device settings. Check available storage and retry.'); }
  };

  // Test scanner
  const testScanner = () => {
    const result = hardware.testScanner();
    setScannerTestResult(result);
    toast(result, { icon: '🔍' });
  };

  // Test printer
  const testPrinter = async () => {
    if (!settingsStore.isLoaded || settingsStore.error) { toast.error('Reload store settings before printing.'); return; }
    toast.loading('Opening print preview...');
    const success = await hardware.testPrinter();
    toast.dismiss();
    if (success) {
      toast.success('Test print requested');
    } else {
      toast.error('Failed to generate test receipt');
    }
  };

  // Test cash drawer
  const testDrawer = async () => {
    const success = await hardware.testDrawer();
    if (success) {
      toast.success('Cash drawer command sent');
    } else {
      toast.error('Failed to open cash drawer');
    }
  };

  const autoRefresh = useLegacyPageRefresh(async () => {
    await settingsStore.fetchSettings(locationId || undefined);
    if (useStoreSettingsStore.getState().error) throw new Error('Settings update failed');
  }, { key: locationId || 'profile', enabled: !!locationId, paused: saving || settingsStore.isLoading || Object.values(dirty.current).some(Boolean) });

  return (
    <ManagementPage>
      <PageHeader
        title="Settings"
        subtitle={isAdmin ? 'Configure your POS system' : 'Manage your profile settings'}
        actions={['ADMIN','SUPER_ADMIN'].includes(user?.role||'')?<Link className="page-action" to="/settings/jobs">Background Jobs</Link>:undefined}
        tabs={<PageTabs label="Settings sections" items={sections} value={selected} onChange={setSection} />}
      />
      {autoRefresh.notice}
      {locationId && settingsStore.isLoading && <p role="status" className="mb-4 text-sm text-muted-foreground">Refreshing store settings...</p>}
      {locationId && settingsStore.error && <div role="alert" className="mb-4 rounded-lg border border-destructive/40 p-4"><p>{settingsStore.error}</p><Button variant="outline" className="mt-2" onClick={() => settingsStore.fetchSettings(locationId || undefined)}>Retry settings</Button></div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" onChangeCapture={() => { dirty.current[selected] = true; }}>
        {selected === 'devices' && !canOperate && <Card><CardHeader><CardTitle>Device diagnostics</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Scanner and browser printing are available on this register. A manager configures devices.</p><Button variant="outline" onClick={testScanner}>Test Scanner</Button><Button variant="outline" onClick={testPrinter}>Test Printer</Button><p role="status">{scannerTestResult}</p></CardContent></Card>}
        {selected === 'store' && (<fieldset disabled={!editable} className="contents">
        {/* Store Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Store className="h-5 w-5 mr-2" />
              Store Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Store Name"
              value={storeSettings.storeName}
              onChange={(e) => setStoreSettings({ ...storeSettings, storeName: e.target.value })}
            />
            <Input
              label="Address"
              value={storeSettings.address}
              onChange={(e) => setStoreSettings({ ...storeSettings, address: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="City"
                value={storeSettings.city}
                onChange={(e) => setStoreSettings({ ...storeSettings, city: e.target.value })}
              />
              <Input
                label="State"
                value={storeSettings.state}
                onChange={(e) => setStoreSettings({ ...storeSettings, state: e.target.value })}
              />
            </div>
            <Input
              label="Phone"
              value={storeSettings.phone}
              onChange={(e) => setStoreSettings({ ...storeSettings, phone: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">Tax applies to taxable products after discounts. The owner sets this store’s rate.</p>
            <Button variant="primary" onClick={saveStoreSettings} disabled={!editable}>Save Changes</Button>
          </CardContent>
        </Card>

        </fieldset>)}

        {selected === 'receipts' && (<fieldset disabled={!editable} className="contents">
        {/* Receipt Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Receipt className="h-5 w-5 mr-2" />
              Receipt Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Receipt Header"
              value={receiptSettings.header}
              onChange={(e) => setReceiptSettings({ ...receiptSettings, header: e.target.value })}
            />
            <Input
              label="Receipt Footer"
              value={receiptSettings.footer}
              onChange={(e) => setReceiptSettings({ ...receiptSettings, footer: e.target.value })}
            />
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={receiptSettings.showAddress}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, showAddress: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Show store address on receipt</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={receiptSettings.showTaxBreakdown}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, showTaxBreakdown: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Show tax breakdown</span>
            </label>
            <Button variant="primary" onClick={saveReceiptSettings} disabled={!editable}>Save Changes</Button>
          </CardContent>
        </Card>

        </fieldset>)}

        {selected === 'payments' && <Card><CardHeader><CardTitle>Store Tax</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">The store owner maintains this location's rate. Checkout applies it automatically to taxable products and preserves the rate on completed sales.</p><Input label="Store sales tax (%)" type="number" min="0" max="100" step="0.0001" value={storeSettings.taxRate ?? 0} disabled={!editable || !canFinance} onChange={e => setStoreSettings({ ...storeSettings, taxRate: Number(e.target.value) })} /><Button onClick={saveTaxSettings} disabled={!editable || !canFinance}>Save tax rate</Button></CardContent></Card>}
        {selected === 'payments' && (<fieldset disabled={!editable} className="contents">
        {/* Payment Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CreditCard className="h-5 w-5 mr-2" />
              Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.cash}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, cash: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Cash</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.card}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, card: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Credit/Debit Card</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.giftCard}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, giftCard: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Gift Card</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.storeCredit}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, storeCredit: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Store Credit</span>
              </label>
            </div>
            <Button variant="primary" onClick={savePaymentMethods} disabled={!editable}>Save Changes</Button>
          </CardContent>
        </Card>

        </fieldset>)}

        {selected === 'pricing' && <PricingRulesCard editable={canOperate} />}

        {selected === 'notifications' && (<fieldset disabled={!editable} className="contents">
        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="h-5 w-5 mr-2" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.lowStockAlerts}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, lowStockAlerts: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Low stock alerts</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.endOfDayReports}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, endOfDayReports: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">End of day reports</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.emailNotifications}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, emailNotifications: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Email notifications</span>
            </label>
            <Input
              label="Notification Email"
              type="email"
              value={notificationSettings.notificationEmail}
              onChange={(e) => setNotificationSettings({ ...notificationSettings, notificationEmail: e.target.value })}
              disabled={!notificationSettings.emailNotifications}
            />
            <Button variant="primary" onClick={saveNotificationSettings} disabled={!editable}>Save Changes</Button>
          </CardContent>
        </Card>

        </fieldset>)}

        {selected === 'devices' && canOperate && (<>
        {/* Barcode Scanner Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Scan className="h-5 w-5 mr-2" />
              Barcode Scanner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.barcodeScanner.enabled}
                onChange={(e) => updateHardwareSettings('barcodeScanner', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable barcode scanner</span>
            </label>
            <Input
              label="Input Timeout (ms)"
              type="number"
              value={hardwareSettings.barcodeScanner.inputTimeout}
              onChange={(e) => updateHardwareSettings('barcodeScanner', 'inputTimeout', parseInt(e.target.value) || 100)}
              disabled={!hardwareSettings.barcodeScanner.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Time between keystrokes to detect scanner vs manual typing. Lower = faster scanner detection.
            </p>
            <Input
              label="Minimum Barcode Length"
              type="number"
              value={hardwareSettings.barcodeScanner.minLength}
              onChange={(e) => updateHardwareSettings('barcodeScanner', 'minLength', parseInt(e.target.value) || 6)}
              disabled={!hardwareSettings.barcodeScanner.enabled}
            />
            {scannerTestResult && (
              <div className="p-3 bg-muted rounded-md text-sm">
                {scannerTestResult}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={testScanner}
                disabled={!hardwareSettings.barcodeScanner.enabled}
              >
                <TestTube2 className="h-4 w-4 mr-2" />
                Test Scanner
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Receipt Printer Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Printer className="h-5 w-5 mr-2" />
              Receipt Printer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.enabled}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable receipt printer</span>
            </label>
            <div>
              <label className="block text-sm font-medium mb-1">Paper Width</label>
              <Select
                value={hardwareSettings.receiptPrinter.paperWidth}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'paperWidth', parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              >
                <option value={58}>58mm (narrow)</option>
                <option value={80}>80mm (standard)</option>
              </Select>
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.autoPrint}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'autoPrint', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              />
              <span className="text-sm">Auto-print receipts</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.showLogo}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'showLogo', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              />
              <span className="text-sm">Show store name</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Store name, address, phone, and footer are configured in Store Information and Receipt Settings above.
            </p>
            <Button
              variant="outline"
              onClick={testPrinter}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            >
              <TestTube2 className="h-4 w-4 mr-2" />
              Print Test Receipt
            </Button>
          </CardContent>
        </Card>

        {/* Cash Drawer Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <DollarSign className="h-5 w-5 mr-2" />
              Cash Drawer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.enabled}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable cash drawer</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.openOnSale}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'openOnSale', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.cashDrawer.enabled}
              />
              <span className="text-sm">Open drawer on sale completion</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.openOnCashPayment}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'openOnCashPayment', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.cashDrawer.enabled}
              />
              <span className="text-sm">Only open for cash payments</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Automatic drawer control is not connected. Open the drawer manually or configure your printer driver.
            </p>
            <Button
              variant="outline"
              onClick={testDrawer}
              disabled={!hardwareSettings.cashDrawer.enabled}
            >
              <TestTube2 className="h-4 w-4 mr-2" />
              Test Cash Drawer
            </Button>
          </CardContent>
        </Card>

        {/* Card Reader Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CreditCard className="h-5 w-5 mr-2" />
              Card Reader (Future)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={false}
                disabled
                onChange={(e) => updateHardwareSettings('cardReader', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Card reader integration is not connected</span>
            </label>
            <Input
              label="Terminal ID"
              value={hardwareSettings.cardReader.terminalId}
              onChange={(e) => updateHardwareSettings('cardReader', 'terminalId', e.target.value)}
              placeholder="Enter your terminal ID"
              disabled={!hardwareSettings.cardReader.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Card payments are recorded after approval on a separate terminal. This POS does not charge cards.
            </p>
          </CardContent>
        </Card>

        {/* Save Hardware Settings */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Hardware Settings</h3>
                <p className="text-sm text-muted-foreground">
                  Save all hardware configuration changes
                </p>
              </div>
              <Button variant="primary" onClick={saveHardwareSettings}>
                <Save className="h-4 w-4 mr-2" />
                Save Hardware Settings
              </Button>
            </div>
          </CardContent>
        </Card>


        </>)}

        {selected === 'profile' && <>
        {/* User Profile — visible to all roles */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Input
                label="First Name"
                value={profileSettings.firstName}
                onChange={(e) => setProfileSettings({ ...profileSettings, firstName: e.target.value })}
              />
              <Input
                label="Last Name"
                value={profileSettings.lastName}
                onChange={(e) => setProfileSettings({ ...profileSettings, lastName: e.target.value })}
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={profileSettings.email}
              onChange={(e) => setProfileSettings({ ...profileSettings, email: e.target.value })}
              className="mb-4"
            />
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Change Password (Optional)</p>
              <p className="text-sm text-muted-foreground mb-3">Leave blank to keep current password</p>
            </div>
            <Input
              label="Current Password"
              type="password"
              placeholder="Required to change password"
              value={profileSettings.currentPassword}
              onChange={(e) => setProfileSettings({ ...profileSettings, currentPassword: e.target.value })}
              className="mb-4"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Input
                label="New Password"
                type="password"
                placeholder="At least 8 characters"
                value={profileSettings.newPassword}
                onChange={(e) => setProfileSettings({ ...profileSettings, newPassword: e.target.value })}
              />
              <Input
                label="Confirm New Password"
                type="password"
                placeholder="Must match new password"
                value={profileSettings.confirmPassword}
                onChange={(e) => setProfileSettings({ ...profileSettings, confirmPassword: e.target.value })}
              />
            </div>
            <Button variant="primary" onClick={saveUserProfile}>Update Profile</Button>
          </CardContent>
        </Card>

        {/* Two-Factor Authentication — visible to all roles */}
        <TwoFactorCard />
        <SecurityNotifications />
        </>}
      </div>
    </ManagementPage>
  );
};
