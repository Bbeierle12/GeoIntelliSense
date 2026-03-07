import { useState, useEffect } from 'react';

interface ApiStatus {
    isAvailable: boolean;
    isLoading: boolean;
    error: string | null;
}

const RUST_URL = 'http://localhost:3001';
const PYTHON_URL = 'http://localhost:3002';

export const useApiStatus = (): ApiStatus => {
    const [isAvailable, setIsAvailable] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkApiStatus = async () => {
            try {
                const [rustRes, pythonRes] = await Promise.all([
                    fetch(`${RUST_URL}/health`).catch(() => null),
                    fetch(`${PYTHON_URL}/api/health`).catch(() => null),
                ]);

                const rustOk = rustRes?.ok ?? false;
                const pythonOk = pythonRes?.ok ?? false;

                if (rustOk && pythonOk) {
                    setIsAvailable(true);
                    setError(null);
                } else if (!rustOk && !pythonOk) {
                    setIsAvailable(false);
                    setError('Backend services are not running. Start them with: docker compose up');
                } else {
                    setIsAvailable(false);
                    setError(
                        !rustOk
                            ? 'Ingestion service (port 3001) is not responding'
                            : 'Analytics service (port 3002) is not responding'
                    );
                }
            } catch (err) {
                setIsAvailable(false);
                setError('Backend services are not running. Start them with: docker compose up');
            } finally {
                setIsLoading(false);
            }
        };

        checkApiStatus();
        const interval = setInterval(checkApiStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    return { isAvailable, isLoading, error };
};
