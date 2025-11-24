import { useState, useEffect } from 'react';

interface ApiStatus {
    isAvailable: boolean;
    isLoading: boolean;
    error: string | null;
}

export const useApiStatus = (): ApiStatus => {
    const [isAvailable, setIsAvailable] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkApiStatus = async () => {
            try {
                const response = await fetch('http://localhost:3001/api/health');
                if (response.ok) {
                    setIsAvailable(true);
                    setError(null);
                } else {
                    setIsAvailable(false);
                    setError('Backend server is not responding correctly');
                }
            } catch (err) {
                setIsAvailable(false);
                setError('Backend server is not running. Start it with: npm run server');
            } finally {
                setIsLoading(false);
            }
        };

        checkApiStatus();
        // Check status every 30 seconds
        const interval = setInterval(checkApiStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    return { isAvailable, isLoading, error };
};