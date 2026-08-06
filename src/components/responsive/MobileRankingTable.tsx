import {Empty, Table, type TableColumnProps} from "@arco-design/web-react";
import {IconDown, IconRight} from "@arco-design/web-react/icon";
import type {Key, MouseEventHandler, ReactNode} from "react";
import {useEffect, useMemo, useState} from "react";

export interface MobileRankingTableProps<T> {
    data: T[];
    rowKey: (record: T, index: number) => Key;
    rank: (record: T, index: number) => ReactNode;
    name: (record: T, index: number) => ReactNode;
    result: (record: T, index: number) => ReactNode;
    details: (record: T, index: number) => ReactNode;
    loading?: boolean;
    emptyDescription?: ReactNode;
    className?: string;
    pagination?: ReactNode;
    expandedRowKeys?: Key[];
    onExpandedRowKeysChange?: (keys: Key[]) => void;
    rowClassName?: (record: T, index: number) => string;
}

/** Compact touch table for ranking-style data. */
export const MobileRankingTable = <T,>({
    data,
    rowKey,
    rank,
    name,
    result,
    details,
    loading = false,
    emptyDescription = "No rankings available",
    className = "",
    pagination,
    expandedRowKeys: controlledExpandedRowKeys,
    onExpandedRowKeysChange,
    rowClassName,
}: MobileRankingTableProps<T>) => {
    type MobileRankingRow = {key: string; record: T; index: number};

    const rows = useMemo<MobileRankingRow[]>(
        () => data.map((record, index) => ({key: String(rowKey(record, index)), record, index})),
        [data, rowKey],
    );
    const dataKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
    const [uncontrolledExpandedRowKeys, setUncontrolledExpandedRowKeys] = useState<string[]>([]);
    const normalizedControlledExpandedRowKeys = useMemo(
        () => controlledExpandedRowKeys?.map(String),
        [controlledExpandedRowKeys],
    );
    const expandedRowKeys = normalizedControlledExpandedRowKeys ?? uncontrolledExpandedRowKeys;
    const validExpandedRowKeys = useMemo(
        () => expandedRowKeys.filter((key) => dataKeys.has(key)),
        [dataKeys, expandedRowKeys],
    );

    useEffect(() => {
        if (validExpandedRowKeys.length !== expandedRowKeys.length) {
            if (controlledExpandedRowKeys === undefined) {
                setUncontrolledExpandedRowKeys(validExpandedRowKeys);
            }
            onExpandedRowKeysChange?.(validExpandedRowKeys);
        }
    }, [controlledExpandedRowKeys, expandedRowKeys.length, onExpandedRowKeysChange, validExpandedRowKeys]);

    const updateExpandedRows = (keys: (string | number)[]) => {
        const normalizedKeys = keys.map(String).filter((key) => dataKeys.has(key));
        if (controlledExpandedRowKeys === undefined) {
            setUncontrolledExpandedRowKeys(normalizedKeys);
        }
        onExpandedRowKeysChange?.(normalizedKeys);
    };

    const columns: TableColumnProps<MobileRankingRow>[] = [
        {
            title: "Rank",
            width: 54,
            render: (_value, row) => rank(row.record, row.index),
        },
        {
            title: "Athlete/Team",
            render: (_value, row) => (
                <span
                    className="mobile-ranking-table__name"
                    onClick={(event) => {
                        const target = event.target as Element;
                        if (target.closest("a,button,[role='button']")) {
                            event.stopPropagation();
                        }
                    }}
                >
                    {name(row.record, row.index)}
                </span>
            ),
        },
        {
            title: "Result",
            width: 92,
            align: "right",
            render: (_value, row) => <span className="mobile-ranking-table__result">{result(row.record, row.index)}</span>,
        },
    ];

    return (
        <div className={`mobile-ranking-table ${className}`}>
            {data.length === 0 && !loading ? <Empty description={emptyDescription} /> : null}
            {data.length > 0 || loading ? (
                <Table
                    rowKey="key"
                    data={rows}
                    columns={columns}
                    loading={loading}
                    pagination={false}
                    tableLayoutFixed
                    expandedRowKeys={validExpandedRowKeys}
                    expandedRowRender={(row) => (
                        <div className="mobile-ranking-table__details">{details(row.record, row.index)}</div>
                    )}
                    rowClassName={(row) => rowClassName?.(row.record, row.index) ?? ""}
                    onExpandedRowsChange={(keys) => updateExpandedRows(keys)}
                    expandProps={{
                        width: 44,
                        columnTitle: "",
                        expandRowByClick: true,
                        icon: (props) => {
                            const {expanded, onClick} = props as typeof props & {
                                onClick?: MouseEventHandler<HTMLButtonElement>;
                            };
                            return (
                                <button
                                    type="button"
                                    onClick={onClick}
                                    aria-expanded={expanded}
                                    aria-label={expanded ? "Collapse row details" : "Expand row details"}
                                    className="mobile-ranking-table__expand-icon"
                                >
                                    {expanded ? <IconDown /> : <IconRight />}
                                </button>
                            );
                        },
                    }}
                />
            ) : null}
            {pagination ? <div className="mobile-ranking-table__pagination">{pagination}</div> : null}
        </div>
    );
};

export default MobileRankingTable;
