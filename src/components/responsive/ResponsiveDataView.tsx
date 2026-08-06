import {Empty, Spin} from "@arco-design/web-react";
import type {ReactNode} from "react";

export interface ResponsiveDataViewProps<T> {
    data: T[];
    loading?: boolean;
    emptyDescription?: ReactNode;
    error?: ReactNode;
    desktop: ReactNode;
    renderTablet?: (item: T, index: number) => ReactNode;
    renderMobile: (item: T, index: number) => ReactNode;
    itemKey?: (item: T, index: number) => string | number;
    pagination?: ReactNode;
    className?: string;
}

/** Shared shell for tables on desktop and touch-friendly cards on phones. */
export const ResponsiveDataView = <T,>({
    data,
    loading = false,
    emptyDescription = "No data",
    error,
    desktop,
    renderTablet,
    renderMobile,
    itemKey,
    pagination,
    className = "",
}: ResponsiveDataViewProps<T>) => {
    const renderItems = (renderer: (item: T, index: number) => ReactNode, classNameForItem: string) =>
        data.map((item, index) => (
            <div key={itemKey?.(item, index) ?? index} className={classNameForItem}>
                {renderer(item, index)}
            </div>
        ));

    return (
        <Spin loading={loading} className={`responsive-data-view ${className}`}>
            {error ? (
                <div className="responsive-data-view__error" role="alert">
                    {error}
                </div>
            ) : (
                <>
                    {data.length === 0 && !loading ? <Empty description={emptyDescription} /> : null}
                    {data.length > 0 ? (
                        <>
                            <div className="responsive-data-view__desktop">{desktop}</div>
                            {renderTablet ? (
                                <div className="responsive-data-view__tablet">
                                    {renderItems(renderTablet, "responsive-data-view__item")}
                                </div>
                            ) : null}
                            <div className="responsive-data-view__mobile">
                                {renderItems(renderMobile, "responsive-data-view__item")}
                            </div>
                        </>
                    ) : null}
                </>
            )}
            {!error && data.length > 0 && pagination ? (
                <div className="responsive-data-view__pagination">{pagination}</div>
            ) : null}
        </Spin>
    );
};

export default ResponsiveDataView;
