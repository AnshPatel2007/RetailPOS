import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import { useAdminViewStore } from '../store/adminViewStore';
import { toast } from 'react-hot-toast';

interface AdminViewBannerProps {
  storeName: string;
  className?: string;
}

/**
 * Banner component to indicate SUPER_ADMIN is viewing another store in read-only mode
 */
export const AdminViewBanner: React.FC<AdminViewBannerProps> = ({ storeName, className = '' }) => {
  const navigate = useNavigate();
  const { exitAdminView } = useAdminViewStore();

  const handleExit = () => {
    exitAdminView();
    navigate('/admin');
    toast.success('Exited admin view mode');
  };

  return (
    <div className={`admin-preview-banner px-4 py-3 shadow-md ${className}`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5" />
          <div>
            <p className="font-semibold text-sm">Viewing: {storeName}</p>
            <p className="text-xs">Read-only view: changes are turned off for this store.</p>
          </div>
        </div>
        <button
          onClick={handleExit}
          className="admin-preview-exit flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <X className="w-4 h-4" />
          Exit View
        </button>
      </div>
    </div>
  );
};
