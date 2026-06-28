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
    <div className={`bg-primary text-primary-foreground px-4 py-3 shadow-md ${className}`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5" />
          <div>
            <p className="font-semibold text-sm">Viewing: {storeName}</p>
            <p className="text-xs opacity-80">Read-Only Mode - You cannot modify data in this view</p>
          </div>
        </div>
        <button
          onClick={handleExit}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary-foreground/20 hover:bg-primary-foreground/30 rounded-lg text-sm font-medium transition-colors"
        >
          <X className="w-4 h-4" />
          Exit View
        </button>
      </div>
    </div>
  );
};
