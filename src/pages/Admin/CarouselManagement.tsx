import {
    Button,
    Form,
    Grid,
    Input,
    InputNumber,
    Message,
    Modal,
    Popconfirm,
    Slider,
    Space,
    Switch,
    Table,
    Typography,
    Upload,
} from "@arco-design/web-react";
import type {ColumnProps} from "@arco-design/web-react/es/Table";
import {IconDelete, IconDown, IconEdit, IconMinus, IconPlus, IconRotateLeft, IconUp} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useMemo, useState} from "react";
import EasyCropper from "react-easy-crop";
import type {Area} from "react-easy-crop";
import type {HomeCarouselImage} from "../../schema/HomeCarouselSchema";
import {
    addCarouselImage,
    deleteCarouselImage,
    getAllCarouselImages,
    reorderCarouselImages,
    updateCarouselImage,
} from "../../services/firebase/homeCarouselService";

const FormItem = Form.Item;
const {Title} = Typography;

interface FormData {
    title: string;
    description: string;
    link: string;
    order: number;
    active: boolean;
}

/**
 * Crop image and return as Blob
 */
async function getCroppedImg(url: string, pixelCrop: Area, rotation = 0): Promise<Blob | null> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.addEventListener("load", () => resolve(img));
        img.addEventListener("error", (error) => reject(error));
        img.src = url;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx || !image) {
        return null;
    }

    const imageSize = 2 * ((Math.max(image.width, image.height) / 2) * Math.sqrt(2));

    canvas.width = imageSize;
    canvas.height = imageSize;

    if (rotation) {
        ctx.translate(imageSize / 2, imageSize / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-imageSize / 2, -imageSize / 2);
    }

    ctx.drawImage(image, imageSize / 2 - image.width / 2, imageSize / 2 - image.height / 2);

    const data = ctx.getImageData(0, 0, imageSize, imageSize);

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.putImageData(
        data,
        Math.round(0 - imageSize / 2 + image.width * 0.5 - pixelCrop.x),
        Math.round(0 - imageSize / 2 + image.height * 0.5 - pixelCrop.y),
    );

    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob);
        });
    });
}

/**
 * Image Cropper Component
 */
interface CropperProps {
    file: File;
    onOk: (file: File) => void;
    onCancel: () => void;
}

const Cropper: React.FC<CropperProps> = (props) => {
    const {file, onOk, onCancel} = props;
    const [crop, setCrop] = useState({x: 0, y: 0});
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | undefined>(undefined);

    const url = useMemo(() => {
        return URL.createObjectURL(file);
    }, [file]);

    const handleCropComplete = (_: Area, croppedAreaPixels: Area) => {
        setCroppedAreaPixels(croppedAreaPixels);
    };

    const handleConfirm = async () => {
        if (!croppedAreaPixels) return;

        const blob = await getCroppedImg(url, croppedAreaPixels, rotation);
        if (blob) {
            const newFile = new File([blob], file.name || "image", {
                type: file.type || "image/*",
            });
            onOk(newFile);
        }
    };

    return (
        <div>
            <div style={{width: "100%", height: 280, position: "relative"}}>
                <EasyCropper
                    style={{
                        containerStyle: {
                            width: "100%",
                            height: 280,
                        },
                    }}
                    aspect={16 / 9}
                    image={url}
                    crop={crop}
                    zoom={zoom}
                    rotation={rotation}
                    onRotationChange={setRotation}
                    onCropComplete={handleCropComplete}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                />
            </div>
            <Grid.Row justify="space-between" style={{marginTop: 20, marginBottom: 20}}>
                <Grid.Row style={{flex: 1, marginLeft: 12, marginRight: 12}}>
                    <IconMinus
                        style={{marginRight: 10, cursor: "pointer"}}
                        onClick={() => {
                            setZoom(Math.max(1, zoom - 0.1));
                        }}
                    />
                    <Slider
                        style={{flex: 1}}
                        step={0.1}
                        value={zoom}
                        onChange={(v) => {
                            if (typeof v === "number") {
                                setZoom(v);
                            }
                        }}
                        min={0.8}
                        max={3}
                    />
                    <IconPlus
                        style={{marginLeft: 10, cursor: "pointer"}}
                        onClick={() => {
                            setZoom(Math.min(3, zoom + 0.1));
                        }}
                    />
                </Grid.Row>
                <IconRotateLeft
                    style={{cursor: "pointer"}}
                    onClick={() => {
                        setRotation(rotation - 90);
                    }}
                />
            </Grid.Row>
            <Grid.Row justify="end">
                <Button onClick={onCancel} style={{marginRight: 20}}>
                    取消
                </Button>
                <Button type="primary" onClick={handleConfirm}>
                    确定
                </Button>
            </Grid.Row>
        </div>
    );
};

export const CarouselManagement: React.FC = () => {
    const [images, setImages] = useState<HomeCarouselImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingImage, setEditingImage] = useState<HomeCarouselImage | null>(null);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [form] = Form.useForm<FormData>();

    useEffect(() => {
        loadImages();
    }, []);

    async function loadImages() {
        setLoading(true);
        try {
            const data = await getAllCarouselImages();
            setImages(data);
        } catch (error) {
            Message.error("Failed to load carousel images");
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    function handleAdd() {
        setEditingImage(null);
        setUploadedFile(null);
        form.resetFields();
        form.setFieldsValue({
            order: images.length > 0 ? Math.max(...images.map((img) => img.order)) + 1 : 1,
            active: true,
        });
        setModalVisible(true);
    }

    function handleEdit(image: HomeCarouselImage) {
        setEditingImage(image);
        setUploadedFile(null);
        form.setFieldsValue({
            title: image.title,
            description: image.description || "",
            link: image.link || "",
            order: image.order,
            active: image.active,
        });
        setModalVisible(true);
    }

    async function handleDelete(image: HomeCarouselImage) {
        try {
            await deleteCarouselImage(image.id, image.imageUrl);
            Message.success("Image deleted successfully");
            await loadImages();
        } catch (error) {
            Message.error("Failed to delete image");
            console.error(error);
        }
    }

    async function handleSubmit() {
        try {
            const values = await form.validate();

            if (editingImage) {
                // Update existing image
                await updateCarouselImage(editingImage.id, {
                    title: values.title,
                    description: values.description || null,
                    link: values.link || null,
                    order: values.order,
                    active: values.active,
                });
                Message.success("Image updated successfully");
            } else {
                // Add new image
                if (!uploadedFile) {
                    Message.error("Please select an image");
                    return;
                }

                await addCarouselImage(uploadedFile, values.title, values.description || null, values.link || null, values.order);
                Message.success("Image added successfully");
            }

            setModalVisible(false);
            await loadImages();
        } catch (error) {
            Message.error("Failed to save image");
            console.error(error);
        }
    }

    async function handleMoveUp(image: HomeCarouselImage, index: number) {
        if (index === 0) return;

        const newImages = [...images];
        const temp = newImages[index - 1].order;
        newImages[index - 1].order = newImages[index].order;
        newImages[index].order = temp;

        try {
            await reorderCarouselImages([
                {id: newImages[index - 1].id, order: newImages[index - 1].order},
                {id: newImages[index].id, order: newImages[index].order},
            ]);
            await loadImages();
        } catch (error) {
            Message.error("Failed to reorder images");
            console.error(error);
        }
    }

    async function handleMoveDown(image: HomeCarouselImage, index: number) {
        if (index === images.length - 1) return;

        const newImages = [...images];
        const temp = newImages[index + 1].order;
        newImages[index + 1].order = newImages[index].order;
        newImages[index].order = temp;

        try {
            await reorderCarouselImages([
                {id: newImages[index].id, order: newImages[index].order},
                {id: newImages[index + 1].id, order: newImages[index + 1].order},
            ]);
            await loadImages();
        } catch (error) {
            Message.error("Failed to reorder images");
            console.error(error);
        }
    }

    const columns: ColumnProps<HomeCarouselImage>[] = [
        {
            title: "Order",
            dataIndex: "order",
            width: 80,
            sorter: (a, b) => a.order - b.order,
        },
        {
            title: "Preview",
            dataIndex: "imageUrl",
            width: 120,
            render: (url: string) => <img src={url} alt="Preview" style={{width: "100px", height: "60px", objectFit: "cover"}} />,
        },
        {
            title: "Title",
            dataIndex: "title",
        },
        {
            title: "Description",
            dataIndex: "description",
            render: (desc: string | null) => desc || "-",
        },
        {
            title: "Link",
            dataIndex: "link",
            render: (link: string | null) =>
                link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer">
                        View
                    </a>
                ) : (
                    "-"
                ),
        },
        {
            title: "Active",
            dataIndex: "active",
            width: 80,
            render: (active: boolean, record: HomeCarouselImage) => (
                <Switch
                    checked={active}
                    onChange={async (checked) => {
                        try {
                            await updateCarouselImage(record.id, {active: checked});
                            await loadImages();
                        } catch (error) {
                            Message.error("Failed to update status");
                        }
                    }}
                />
            ),
        },
        {
            title: "Actions",
            width: 200,
            render: (_: unknown, record: HomeCarouselImage, index: number) => (
                <Space>
                    <Button size="small" icon={<IconUp />} disabled={index === 0} onClick={() => handleMoveUp(record, index)} />
                    <Button
                        size="small"
                        icon={<IconDown />}
                        disabled={index === images.length - 1}
                        onClick={() => handleMoveDown(record, index)}
                    />
                    <Button size="small" type="primary" icon={<IconEdit />} onClick={() => handleEdit(record)} />
                    <Popconfirm
                        title="Are you sure you want to delete this image?"
                        onOk={() => handleDelete(record)}
                        okButtonProps={{status: "danger"}}
                    >
                        <Button size="small" status="danger" icon={<IconDelete />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <div className="bg-white flex flex-col w-full h-fit gap-4 p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center mb-4">
                    <Title heading={3}>Carousel Management</Title>
                    <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>
                        Add Image
                    </Button>
                </div>
                <div className="w-full">
                    <Table loading={loading} columns={columns} data={images} rowKey="id" pagination={{pageSize: 10}} stripe />
                </div>
            </div>

            <Modal
                title={editingImage ? "Edit Carousel Image" : "Add Carousel Image"}
                visible={modalVisible}
                onOk={handleSubmit}
                onCancel={() => setModalVisible(false)}
                style={{width: "600px"}}
            >
                <Form form={form} layout="vertical">
                    {!editingImage && (
                        <FormItem label="Image" required rules={[{required: true, message: "Please upload an image"}]}>
                            <Upload
                                accept="image/*"
                                limit={1}
                                autoUpload={false}
                                beforeUpload={(file) => {
                                    return new Promise((resolve) => {
                                        const modal = Modal.confirm({
                                            title: "裁剪图片",
                                            onCancel: () => {
                                                Message.info("取消上传");
                                                resolve(false);
                                                modal.close();
                                            },
                                            simple: false,
                                            content: (
                                                <Cropper
                                                    file={file}
                                                    onOk={(croppedFile) => {
                                                        resolve(croppedFile);
                                                        modal.close();
                                                    }}
                                                    onCancel={() => {
                                                        resolve(false);
                                                        Message.info("取消上传");
                                                        modal.close();
                                                    }}
                                                />
                                            ),
                                            footer: null,
                                        });
                                    });
                                }}
                                onChange={(_, currentFile) => {
                                    if (currentFile?.originFile) {
                                        setUploadedFile(currentFile.originFile as File);
                                    }
                                }}
                                onRemove={() => setUploadedFile(null)}
                            />
                        </FormItem>
                    )}

                    <FormItem label="Title" field="title" required rules={[{required: true, message: "Title is required"}]}>
                        <Input placeholder="Enter image title" />
                    </FormItem>

                    <FormItem label="Description" field="description">
                        <Input.TextArea placeholder="Enter image description (optional)" rows={3} />
                    </FormItem>

                    <FormItem label="Link" field="link">
                        <Input placeholder="Enter link URL (optional)" />
                    </FormItem>

                    <FormItem label="Order" field="order" required rules={[{required: true, message: "Order is required"}]}>
                        <InputNumber placeholder="Enter display order" min={1} />
                    </FormItem>

                    <FormItem label="Active" field="active" triggerPropName="checked">
                        <Switch />
                    </FormItem>
                </Form>
            </Modal>
        </div>
    );
};
