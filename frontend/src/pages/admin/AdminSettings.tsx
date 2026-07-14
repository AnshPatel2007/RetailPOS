import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/Card';
import { PageHeader } from '@/components/common/PageHeader';
import {
  Store,
  Users,
  Settings,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';

/**
 * Admin settings hub. Earlier versions of this page showed system/security/
 * backup controls that only wrote to localStorage and did nothing — those
 * have been removed. This page now links to the places where real,
 * persisted configuration lives.
 */
export const AdminSettings: React.FC = () => {
  const links = [
    {
      to: '/settings',
      icon: Settings,
      title: 'Store & System Settings',
      description:
        'Store information, receipts, payment methods, notifications, and hardware configuration. Saved to the backend and shared across users.',
    },
    {
      to: '/settings',
      icon: ShieldCheck,
      title: 'Account Security',
      description:
        'Update your profile, change your password, and manage two-factor authentication from the Settings page.',
    },
    {
      to: '/admin/users',
      icon: Users,
      title: 'User Management',
      description:
        'Create, edit, deactivate, and assign roles and locations to users.',
    },
    {
      to: '/admin/stores',
      icon: Store,
      title: 'Store Management',
      description: 'Manage store locations, tax rates, and store status.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        subtitle="Configuration lives in the pages below"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {links.map((link) => (
          <Link key={link.title} to={link.to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-primary/10 text-primary">
                    <link.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold flex items-center gap-2">
                      {link.title}
                      <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {link.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
};
