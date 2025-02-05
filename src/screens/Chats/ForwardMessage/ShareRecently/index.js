import React from "react";
import { View, FlatList, Platform, Keyboard } from "react-native";
import { connect } from "react-redux";
import styles from "./styles";
import { AppText } from "components";
import chatFn from "screens/Chats/Chat/Functions";
import { Toast, Spinner } from "native-base";
import { chatHistoriesAction, types } from "actions";
import I18n from "helper/locales";
import firebase from "firebase";
import { DEVICE, GROUP_TYPE, USER_TYPE, CHAT_TYPE } from "helper/Consts";
import { createGroupName } from "screens/Chats/ChatHistories/Component/Functions";
import { Colors } from "helper";
import ItemChatForward from "../Components/ItemChatForward";

const _ = require("lodash");
const moment = require("moment");
const PAGE_LIMIT = 10;
const END_PAGE = "Invalid page.";
const NUMBER_MESS = 20;

class ShareRecently extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            listGroup: [],
            refresh: false,
            page: 1,
            numberOfPage: 1,
            firstTime: true,
            keyboardHeight: 60,
            spinner: false
        };
        this.refUpdateChanel = firebase.database().ref(`/user-update-message/${props.userReducer.data.id}`);
        this.searchText = "";
    }

    componentDidMount() {
        // load lai trang khi tu man khac vao
        this.refUpdateChanel.limitToLast(1).on("child_added", childSnapshot => {
            this.onHotReload();
        });
        this.onRefresh();

        // KEYBOARD SHOW EVENT
        this.keyboardWillShowListener = Keyboard.addListener("keyboardDidShow", e => {
            this.setState({ keyboardHeight: e.endCoordinates.height + 60 - 55 });
        });

        // KEYBOARD HIDE EVENT
        this.keyboardWillShowListener = Keyboard.addListener("keyboardDidHide", e => {
            this.setState({ keyboardHeight: 60 });
        });
    }

    componentDidUpdate(prevProps) {
        let { chatHistoriesReducer, search } = this.props;
        let { page, refresh } = this.state;
        if (chatHistoriesReducer !== prevProps.chatHistoriesReducer) {
            if (chatHistoriesReducer.type == types.CHAT_HISTORIES_SUCCESS) {
                let listGroup = chatHistoriesReducer.data.results;
                let numberOfPage = chatHistoriesReducer.data.numberOfPage;
                this.setState({ listGroup, refresh: false, numberOfPage });
            }
            if (chatHistoriesReducer.type == types.CHAT_HISTORIES_FAILED) {
                this.setState({ refresh: false });
            }
        }

        if (search !== prevProps.search) {
            this.onChangeText(search);
        }
    }

    loadGroup(id, page) {
        const { dispatch } = this.props;
        let params = {
            user_id: id,
            page: page
        };
        dispatch(chatHistoriesAction.chatHistoriesRequest(params));
    }

    onEndReached() {
        let { numberOfPage, page, firstTime } = this.state;

        if (!_.isEmpty(this.searchText)) {
            this.setState({ firstTime: false });
        } else {
            const { userReducer } = this.props;
            const user = userReducer.data;
            if (page < numberOfPage) {
                page++;
                this.setState({ page }, () => {
                    this.loadGroup(user.id, page);
                });
            } else {
                // console.log("notEndReached");
            }
        }
    }

    onHotReload() {
        const { userReducer } = this.props;
        const user = userReducer.data;
        if (!_.isEmpty(this.searchText)) {
            this.searchGroupChat(this.searchText);
        } else {
            this.setState({ page: 1 }, () => {
                this.loadGroup(user.id, 1);
            });
        }
    }

    onRefresh() {
        const { userReducer } = this.props;
        const user = userReducer.data;
        if (!_.isEmpty(this.searchText)) {
            this.searchGroupChat(this.searchText);
        } else {
            this.setState({ page: 1, refresh: true }, () => {
                this.loadGroup(user.id, 1);
            });
        }
    }

    updateRoomChat(chat_room, messages) {
        for (let i in chat_room.users) {
            let createdAt =
                _.isEmpty(messages) && _.isEmpty(messages[0]) ? moment.utc().valueOf() : messages[0].createdAt;

            let user = chat_room.users[i];
            // SET NOTIFICATION ID
            firebase
                .database()
                .ref(`/user-update-message/${user.id}`)
                .push({ createdAt })
                .then(data => {})
                .catch(error => {
                    console.log("error ", error);
                });
        }
    }

    navigateToChat(chatRoom) {
        this.setState({ spinner: true }, () => {
            const { navigation, userReducer, contactReducer } = this.props;
            const { chat_room } = chatRoom;
            const { name, users, last_message_index, id } = chat_room;
            const userData = userReducer.data;
            const message = navigation.getParam("message");
            const user = chatFn.converUser(userData);
            const forwardMess = chatFn.convertForwardMessage(message, user, last_message_index);
            firebase
                .database()
                .ref(`/chat-group/${chat_room.id}`)
                .push(forwardMess)
                .then(data => {
                    let paramsLastMessage = chatFn.lastMessParam(forwardMess, id, user, forwardMess.index).lastMessage;
                    chatHistoriesAction.updateLastMessage(paramsLastMessage).then(() => {
                        setTimeout(() => {
                            let params = chatFn.lastMessParam(forwardMess, chatRoom.id, user, forwardMess.index)
                                .lastSeenMessage;
                            chatHistoriesAction.updateLastSeenMessage(params).then(() => {
                                setTimeout(() => {
                                    this.setState({ spinner: false }, () => {
                                        Toast.show({
                                            text: I18n.t("toast.forwardMessSuccess"),
                                            type: "success"
                                        });
                                    });
                                    this.updateRoomChat(chat_room, [forwardMess]);
                                    this.sendNotification(chatRoom, chat_room, forwardMess, user);
                                }, 500);
                            });
                        }, 500);
                    });
                })
                .catch(error => {
                    console.log(error);
                });
        });
    }

    sendNotification(currentRoom, chatRoomInfo, messages, user) {
        const dataContact = this.props.contactReducer.data.response;
        const { groupName } = createGroupName(
            currentRoom.name,
            chatRoomInfo.users,
            user.id,
            dataContact,
            chatRoomInfo.type
        );
        let notificationId = [];
        let results = chatRoomInfo.users.map(async item => {
            if (item.id != user.id) {
                if (item.type == USER_TYPE.STUDENT) {
                    notificationId.push(item.notificationId);
                    return item.notificationId;
                }
                await firebase
                    .database()
                    .ref(`/status/`)
                    .orderByChild("id")
                    .endAt(item.id)
                    .limitToLast(1)
                    .once("value", childSnapshot => {
                        const message = childSnapshot.toJSON();
                        let value = message ? Object.values(message) : "";
                        if (
                            value &&
                            value[0].id == item.id &&
                            value[0].notificationSilent &&
                            Object.values(value[0].notificationSilent).indexOf(chatRoomInfo.id) > -1
                        ) {
                            return;
                        }
                        if (value == "" || value[0].id != item.id || value[0].status) {
                            notificationId.push(item.notificationId);
                            return item.notificationId;
                        }
                    });
            }
        });
        Promise.all(results).then(() => {
            const body = this.convertNoti(messages.type, messages.text);
            let name = user.name;
            let group_type = currentRoom.type;
            let group_name = group_type == GROUP_TYPE.GROUP ? groupName : "";
            const title = {
                name,
                group_name
            };
            let content = {
                notificationId,
                noti: {
                    body,
                    title: group_type == GROUP_TYPE.GROUP ? name + " gửi tới " + group_name : name
                },
                message: {
                    body,
                    title,
                    type: "Chat",
                    chatRoomId: chatRoomInfo.id,
                    group_type
                }
            };
            chatHistoriesAction.sendNotiForOther(content);
        });
    }

    convertNoti(messageType, lastMessage) {
        let message = "";
        switch (messageType) {
            case CHAT_TYPE.IMAGE:
                message = I18n.t("chat.imageType");
                break;
            case CHAT_TYPE.IMAGES:
                message = I18n.t("chat.imagesType");
                break;
            case CHAT_TYPE.FILE:
                message = I18n.t("chat.fileType");
                break;
            case CHAT_TYPE.LOCATION:
                message = I18n.t("chat.locationType");
                break;
            case CHAT_TYPE.CONTACT:
                message = I18n.t("chat.contactType");
                break;
            case CHAT_TYPE.REPLY:
                message = I18n.t("chat.replyType");
                break;
            default:
                message = lastMessage;
                break;
        }
        return message;
    }

    renderItem(item, index) {
        const { userReducer, contactReducer } = this.props;
        const userData = userReducer.data;
        if (_.isEmpty(userData)) {
            return null;
        } else {
            const { chat_room, last_message_seen_index } = item;
            const {
                last_message_time,
                name,
                users,
                last_message,
                last_message_index,
                last_message_type,
                type
            } = chat_room;
            let time = last_message_time;
            let dataContact = contactReducer.data.response;
            let covertData = createGroupName(name, users, userData.id, dataContact, type);
            let groupName = covertData.groupName;
            let source = covertData.avatar;
            let unreadMessage = last_message_index - last_message_seen_index;
            return (
                <ItemChatForward
                    userId={userData.id}
                    messageType={last_message_type}
                    chatRoom={chat_room}
                    time={time}
                    source={source}
                    groupName={groupName}
                    lastMessage={last_message}
                    unreadMessage={unreadMessage}
                    onPress={() => this.navigateToChat(item)}
                />
            );
        }
    }

    searchGroupChat(e) {
        let { userReducer } = this.props;
        let param = {
            search: e.trim(),
            user_id: userReducer.data.id,
            type: ""
        };
        chatHistoriesAction.searchGroupChat(param).then(response => {
            if (response.error) {
            } else {
                this.setState({ listGroup: response.response });
            }
        });
    }

    onChangeText(e) {
        let { chatHistoriesReducer } = this.props;
        let listGroup = chatHistoriesReducer.data ? chatHistoriesReducer.data.results : [];
        if (!_.isEmpty(e.trim())) {
            this.searchText = e.trim();
            if (this.timeout) {
                clearTimeout(this.timeout);
            }
            this.timeout = setTimeout(() => {
                this.searchGroupChat(e);
            }, 500);
        } else {
            this.searchText = "";
            this.setState({ listGroup });
        }
    }

    emptyList() {
        let { refresh } = this.state;
        return (
            !refresh && (
                <View style={styles.containerEmpty}>
                    <AppText text={I18n.t("chat.emptyList")} style={styles.emptyText} />
                    <AppText text={I18n.t("chat.suggest")} style={styles.emptySuggest} />
                </View>
            )
        );
    }

    spinner() {
        let { spinner } = this.state;
        return spinner ? (
            <View
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: DEVICE.DEVICE_HEIGHT,
                    width: DEVICE.DEVICE_WIDTH,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    zIndex: 3,
                    justifyContent: "center"
                }}
            >
                <Spinner color="#000000" />
            </View>
        ) : null;
    }

    render() {
        let { listGroup, refresh, keyboardHeight } = this.state;
        let { navigation } = this.props;
        return (
            <View style={styles.container}>
                <View style={{ flex: 1, backgroundColor: Colors.SKY_BLUE }}>
                    <FlatList
                        data={listGroup}
                        contentContainerStyle={{ paddingBottom: keyboardHeight }}
                        keyExtractor={(item, index) => index.toString()}
                        extraData={listGroup}
                        onEndReached={() => this.onEndReached()}
                        onEndReachedThreshold={Platform.OS == "android" ? 0.1 : 0}
                        renderItem={({ item, index }) => this.renderItem(item, index)}
                        refreshing={refresh}
                        onRefresh={() => this.onRefresh()}
                        ListEmptyComponent={() => this.emptyList()}
                    />
                </View>
                {this.spinner()}
            </View>
        );
    }
}

function mapStateToProps(state) {
    return {
        userReducer: state.userReducer,
        chatHistoriesReducer: state.chatHistoriesReducer,
        contactReducer: state.contactReducer
    };
}
ShareRecently = connect(mapStateToProps)(ShareRecently);
export default ShareRecently;
