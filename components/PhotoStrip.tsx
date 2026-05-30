import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import { fs, colors } from '../lib/platform';
import type { JobPhoto } from '../lib/types';

interface Props {
  photos: JobPhoto[];
}

function getPhotoUrl(path: string): string {
  const { data } = supabase.storage.from('job-photos').getPublicUrl(path);
  return data.publicUrl;
}

export default function PhotoStrip({ photos }: Props) {
  if (photos.length === 0) {
    return <Text style={styles.empty}>// NO PHOTOS YET</Text>;
  }

  return (
    <FlatList
      horizontal
      data={photos}
      keyExtractor={p => p.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.thumb} activeOpacity={0.8}>
          <Image
            source={{ uri: getPhotoUrl(item.storage_path) }}
            style={styles.image}
            resizeMode="cover"
          />
          <Text style={styles.typeLabel}>
            {(item.photo_type ?? 'other').toUpperCase()}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  empty: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(13),
    color: colors.muted,
  },
  thumb: {
    width: 80,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: 80, height: 80 },
  typeLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: fs(8),
    color: colors.muted,
    letterSpacing: 1,
    padding: 3,
    textAlign: 'center',
  },
});
