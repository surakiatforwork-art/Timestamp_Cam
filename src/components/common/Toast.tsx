import { Download, Check, Info, CircleAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function Toast() {
    const { state } = useApp();

    if (state.toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {state.toasts.map((toast) => {
                const exported = toast.type === "success" && toast.message.startsWith("ดาวน์โหลด");
                const Icon = exported ? Download : toast.type === "success" ? Check : toast.type === "error" ? CircleAlert : Info;
                return (
                <div key={toast.id} className={`toast ${exported ? "exported" : toast.type}`} role="status">
                    <Icon className="ui-icon" aria-hidden="true" />
                    {toast.message}
                </div>
            ); })}
        </div>
    );
}
