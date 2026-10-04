import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BrandBlock } from '@/components/BrandMark';
import { Card, Screen, Txt } from '@/components/ui';

/** Centered card layout for sign-in, registration and password pages (the website's AuthShell). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Screen back keyboard contentStyle={styles.content}>
      <View style={styles.head}>
        <BrandBlock size={52} />
        <Txt variant="title" center style={{ marginTop: 16 }}>{title}</Txt>
        {subtitle ? <Txt variant="small" center style={{ marginTop: 6 }}>{subtitle}</Txt> : null}
      </View>
      <Card style={{ gap: 14 }}>{children}</Card>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingTop: 24 }, head: { alignItems: 'center', marginBottom: 22 }, footer: { marginTop: 18, alignItems: 'center', gap: 6 } });
