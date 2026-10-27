#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static NSString *SelectedText(AXUIElementRef application) {
    CFTypeRef focused = NULL;
    if (AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, &focused) != kAXErrorSuccess || !focused) return nil;
    if (CFGetTypeID(focused) != AXUIElementGetTypeID()) { CFRelease(focused); return nil; }
    AXUIElementSetMessagingTimeout((AXUIElementRef)focused, 0.4);
    CFTypeRef selected = NULL;
    AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXSelectedTextAttribute, &selected);
    CFRelease(focused);
    return selected ? CFBridgingRelease(selected) : nil;
}

static NSString *CopySelection(pid_t pid) {
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    NSMutableArray *saved = [NSMutableArray array];
    for (NSPasteboardItem *item in board.pasteboardItems) {
        NSMutableDictionary *entries = [NSMutableDictionary dictionary];
        for (NSPasteboardType type in item.types) {
            NSData *data = [item dataForType:type];
            if (data) entries[type] = data;
        }
        [saved addObject:entries];
    }
    // A private marker distinguishes a fresh Copy from unchanged clipboard text.
    [board clearContents];
    [board setString:NSUUID.UUID.UUIDString forType:@"com.languageailab.translate.capture"];
    NSInteger ownedChange = board.changeCount;
    NSString *text = nil;
    CGEventRef down = NULL, up = NULL;
    @try {
        if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) return nil;
        down = CGEventCreateKeyboardEvent(NULL, 8, true);
        up = CGEventCreateKeyboardEvent(NULL, 8, false);
        if (!down || !up) return nil;
        CGEventSetFlags(down, kCGEventFlagMaskCommand);
        CGEventSetFlags(up, kCGEventFlagMaskCommand);
        CGEventPostToPid(pid, down);
        CGEventPostToPid(pid, up);
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1.2];
        while (deadline.timeIntervalSinceNow > 0) {
            if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) return nil;
            if (board.changeCount != ownedChange) {
                NSInteger copiedChange = board.changeCount;
                text = [board stringForType:NSPasteboardTypeString];
                if (board.changeCount != copiedChange) return nil;
                ownedChange = copiedChange;
                break;
            }
            [NSThread sleepForTimeInterval:0.02];
        }
    } @finally {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        // Preserve the old formats, but never overwrite a later unrelated change.
        if (board.changeCount == ownedChange) {
            [board clearContents];
            NSMutableArray *items = [NSMutableArray array];
            for (NSDictionary *entries in saved) {
                NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
                for (NSPasteboardType type in entries) [item setData:entries[type] forType:type];
                [items addObject:item];
            }
            if (items.count) [board writeObjects:items];
        }
    }
    return text;
}

static BOOL HasText(id text) {
    return [text isKindOfClass:NSString.class] && [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length > 0;
}

static NSDictionary *Capture(void) {
    if (!AXIsProcessTrusted()) return @{ @"error": @"accessibility" };
    NSRunningApplication *frontmost = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!frontmost) return @{ @"error": @"no-selection" };
    pid_t pid = frontmost.processIdentifier;
    // Wait for Command+B to be released so Copy cannot inherit the B key.
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1];
    while (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, 11) && deadline.timeIntervalSinceNow > 0) {
        [NSThread sleepForTimeInterval:0.02];
    }
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid || CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, 11)) return @{ @"error": @"no-selection" };
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.4);
    NSString *text = SelectedText(application);
    CFRelease(application);
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) return @{ @"error": @"no-selection" };
    if (HasText(text)) return @{ @"text": text };
    text = CopySelection(pid);
    return HasText(text) ? @{ @"text": text } : @{ @"error": @"no-selection" };
}

int TranslateAccessibilityTrusted(void) {
    return AXIsProcessTrusted() ? 1 : 0;
}

int TranslateCaptureProcessId(void) {
    return NSProcessInfo.processInfo.processIdentifier;
}

char *TranslateCaptureSelection(void) {
    @autoreleasepool {
        NSDictionary *result;
        @try { result = Capture(); }
        @catch (NSException *exception) { result = @{ @"error": @"capture-failed" }; }
        NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        if (!data) return NULL;
        return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    }
}

void TranslateFreeResult(void *result) {
    free(result);
}
