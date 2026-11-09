import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error';
export type ShowToast = (message: string, tone?: ToastTone) => void;

export const ToastContext = createContext<ShowToast>(() => {});
/** Shows a short message in the corner: success (polite) or error (announced at once). */
export const useToast = () => useContext(ToastContext);
